/**
 * TRAILING MANAGER — v55.51 panel entegrasyon katmanının TS portu.
 *
 * Panel referansı:
 *   syncTrailsWithPositions   → satır 11131-11162
 *   checkRallyActivation      → satır 11199-11222
 *   processTrailingStops      → satır 11224-11269
 *   _autoExit                 → satır 11271-11296
 *   _cancelAlgoOrders         → satır 11164-11197
 *   trailingTick              → satır 11298-11318
 *
 * v2 İYİLEŞTİRMELERİ (eski paneldeki "kabul edilmiş" sorunları kapatır):
 *   1. _autoExit race koruması: mode geçişi _autoExit'i bekler (eski:
 *      "düşük olasılık, kabul edilmiş" diye atlanmıştı).
 *   2. Dependency injection: OKX/Telegram/Storage interface üzerinden;
 *      test edilebilir + Faz 1b paket #3 ile bağlanma noktası net.
 *   3. Tip güvenliği: 'long'/'LONG' karışıklığı runtime hatası yerine
 *      derleme hatası olarak yakalanır.
 *
 * DAVRANIŞ panelle birebir:
 *   - 30 sn tick interval, 10 sn ilk gecikme
 *   - Ralli tetik %2 kâr (rawKar)
 *   - 4H mum tabanlı (önceki kapanmış mum + son 16+ bar gerekli)
 *   - _trailLock mutex (concurrent tick koruması)
 *   - Sync sonrası kayıp pozisyonlar trail'den silinir
 */

import { KademeliTrailingStop } from "./kademeli";
import {
  loadTrails,
  saveTrails,
  type StorageLike,
  type TrailsByInstId,
} from "./persistence";
import type { OkxKline, OkxPosition } from "@/types/okx";

// ═══════════════════════════════════════════════════════════════════
// DEPENDENCY INJECTION INTERFACE
// ═══════════════════════════════════════════════════════════════════

/**
 * Manager'ın dış dünyaya ihtiyaç duyduğu tüm bağımlılıklar.
 * Browser'da gerçek OKX/Telegram fonksiyonları geçilir.
 * Testte mock'lar geçilir.
 */
export interface TrailingDeps {
  /** Mevcut açık pozisyonlar (ST.positions analogu) */
  getPositions(): readonly OkxPosition[];

  /** Mum verisi çek (panel `getKlines` analogu) — eskiden→yeniye sıralı */
  getKlines(
    pair: string,
    tf: "4h" | "1h",
    limit: number,
  ): Promise<readonly OkxKline[]>;

  /** ATR hesabı (panel `ATR()` — varsayılan period 14) */
  computeAtr(candles: readonly OkxKline[], period?: number): number | null;

  /** OKX algo emirlerini iptal et (TP1/SL — ralli aktivasyonunda) */
  cancelAlgoOrders(instId: string): Promise<boolean>;

  /** Pozisyonu market close ile kapat */
  closePosition(pos: OkxPosition): Promise<{ ok: boolean; err?: string }>;

  /** Telegram bildirimi (opsiyonel) */
  sendTelegram?(message: string): void;

  /** Toast bildirimi (opsiyonel) */
  toast?(message: string, type: "ok" | "info" | "err"): void;

  /** Şu an demo modunda mı (Telegram prefix + storage key için) */
  isDemoMode(): boolean;

  /** localStorage abstraction */
  storage: StorageLike;

  /** Sonraki çağrıyı geciktirmek için (testte fake timer kullanılabilir) */
  delay?(ms: number): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// MANAGER
// ═══════════════════════════════════════════════════════════════════

export interface TrailingManagerOptions {
  /** 4H trail için ATR period (varsayılan 14) */
  atrPeriod?: number;
  /** Ralli tetik eşiği yüzde (varsayılan %2) */
  rallyThresholdPct?: number;
  /** Tick aralığı ms (varsayılan 30_000) */
  tickIntervalMs?: number;
  /** İlk tick öncesi gecikme ms (varsayılan 10_000) */
  initialDelayMs?: number;
}

/**
 * Trailing manager — saf class, browser API'lerine doğrudan dokunmaz.
 *
 * Yaşam döngüsü:
 *   1. const m = new TrailingManager(deps, options)
 *   2. m.start()  → setTimeout + setInterval kurar
 *   3. m.stop()   → interval'ları durdurur, devam eden tick'i bekler
 *   4. m.handleModeChange()  → trail state temizle, yeniden yükle
 */
export class TrailingManager {
  private trails: TrailsByInstId = {};
  private tickLock = false;
  private exitInProgress = new Set<string>(); // _autoExit race koruması
  private interval: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  private readonly atrPeriod: number;
  private readonly rallyThresholdPct: number;
  private readonly tickIntervalMs: number;
  private readonly initialDelayMs: number;

  constructor(
    private deps: TrailingDeps,
    options: TrailingManagerOptions = {},
  ) {
    this.atrPeriod = options.atrPeriod ?? 14;
    this.rallyThresholdPct = options.rallyThresholdPct ?? 2.0;
    this.tickIntervalMs = options.tickIntervalMs ?? 30_000;
    this.initialDelayMs = options.initialDelayMs ?? 10_000;
  }

  /** localStorage'tan trail'leri yükle. Mode değişiminde tekrar çağrılır. */
  load(): void {
    this.trails = loadTrails(this.deps.storage, this.deps.isDemoMode());
  }

  /** Tüm trail'leri persist et. */
  private save(): void {
    saveTrails(this.trails, this.deps.storage, this.deps.isDemoMode());
  }

  /** Aktif trail'lerin debug görünümü (UI / window.TRAIL.state için). */
  getState(): TrailsByInstId {
    return this.trails;
  }

  /** Belli bir instId için durum (UI gösterimi). */
  getDurum(instId: string) {
    return this.trails[instId]?.instance.durum();
  }

  /**
   * Mode değişimi (prod ↔ demo) — eski paneldeki race condition'ı
   * v2'de TAM kapatır.
   *
   * Akış:
   *   1. Yeni tick başlamasını engelle (stop)
   *   2. Devam eden tick'i bekle
   *   3. Devam eden _autoExit'leri bekle (eski panelde KORUNMAMIŞ — bizim ek koruma)
   *   4. Trail state temizle
   *   5. Yeni mode'la load
   *   6. Tick'i yeniden başlat
   */
  async handleModeChange(): Promise<void> {
    this.stop();
    // Aktif tick + autoExit operasyonlarının bitmesini bekle
    await this.waitForIdle();
    this.trails = {};
    this.load();
    this.start();
  }

  /** Tüm async operasyonlar bitene kadar bekle (mode geçişinde kullanılır). */
  private async waitForIdle(maxWaitMs = 5_000): Promise<void> {
    const startTs = Date.now();
    const delay = this.deps.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    while (
      (this.tickLock || this.exitInProgress.size > 0) &&
      Date.now() - startTs < maxWaitMs
    ) {
      await delay(100);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // SYNC: pozisyon listesindeki değişiklikleri trail map'ine yansıt
  // Kaynak: panel `syncTrailsWithPositions` satır 11131-11162
  // ───────────────────────────────────────────────────────────────────

  private syncTrailsWithPositions(): void {
    const positions = this.deps.getPositions();
    const currentIds = new Set(positions.map((p) => p.instId));

    // Yeni pozisyonlar için trail oluştur
    for (const p of positions) {
      if (this.trails[p.instId]) continue;
      const giris = parseFloat(p.avgPx || "0");
      if (giris <= 0) continue;

      let yon: "LONG" | "SHORT";
      if (p.posSide === "long") yon = "LONG";
      else if (p.posSide === "short") yon = "SHORT";
      else {
        // 'net' mode — pos işaretinden anla
        const posSize = parseFloat(p.pos || "0");
        yon = posSize >= 0 ? "LONG" : "SHORT";
      }

      this.trails[p.instId] = {
        instance: new KademeliTrailingStop(yon),
        last4hCloseTs: 0,
        rallyActivated: false,
        giris_fiyat: giris,
      };
      this.deps.toast?.(`Trail aktif: ${p.instId} ${yon}`, "info");
    }

    // Kapatılmış pozisyonlar için trail sil
    for (const instId of Object.keys(this.trails)) {
      if (!currentIds.has(instId)) {
        delete this.trails[instId];
        // _autoExit progress içinde olabilir; orada da silinecek
      }
    }
    this.save();
  }

  // ───────────────────────────────────────────────────────────────────
  // RALLI: %2 kâra ulaşan pozisyon için TP1/SL iptal + trail aktivasyonu
  // Kaynak: panel `checkRallyActivation` satır 11199-11222
  // ───────────────────────────────────────────────────────────────────

  private async checkRallyActivation(instId: string): Promise<void> {
    const trail = this.trails[instId];
    if (!trail || trail.rallyActivated) return;

    const pos = this.deps.getPositions().find((p) => p.instId === instId);
    if (!pos) return;

    const currentPx = parseFloat(pos.markPx || pos.last || "0");
    if (currentPx <= 0) return;

    const entryPx = trail.giris_fiyat;
    const isLong = trail.instance.yon === "LONG";
    const rawKar = isLong
      ? ((currentPx - entryPx) / entryPx) * 100
      : ((entryPx - currentPx) / entryPx) * 100;

    if (rawKar < this.rallyThresholdPct) return;

    trail.rallyActivated = true;
    this.save();

    await this.deps.cancelAlgoOrders(instId);
    this.deps.toast?.(`🚀 Ralli: ${instId} TP1 iptal, trailing aktif`, "ok");

    const pfx = this.deps.isDemoMode() ? "🧪 DEMO · " : "";
    this.deps.sendTelegram?.(
      `${pfx}🚀 RALLI MODU\n${instId}\nKâr %${rawKar.toFixed(2)} — TP1 iptal, 4H trailing devreye girdi.`,
    );
  }

  // ───────────────────────────────────────────────────────────────────
  // PROCESS: 4H mum kapanışında trail.guncelle() ve gerekirse _autoExit
  // Kaynak: panel `processTrailingStops` satır 11224-11269
  // ───────────────────────────────────────────────────────────────────

  private async processTrailingStops(): Promise<void> {
    for (const [instId, trail] of Object.entries(this.trails)) {
      if (trail.instance.cikis_tetiklendi) continue;
      if (!trail.rallyActivated) continue;

      const pair = instId.split("-")[0];
      try {
        const klines = await this.deps.getKlines(pair, "4h", 30);
        if (!klines || klines.length < 16) continue;

        const lastIdx = klines.length - 1;
        const prevClosed = klines[lastIdx - 1];
        const closeTs = prevClosed.t;
        if (closeTs <= trail.last4hCloseTs) continue;

        const kapanis = prevClosed.c;
        const suanki = klines[lastIdx].c;
        if (
          !isFinite(kapanis) ||
          !isFinite(suanki) ||
          kapanis <= 0 ||
          suanki <= 0
        ) {
          continue;
        }

        const klinesForAtr = klines.slice(0, lastIdx + 1);
        const atr = this.deps.computeAtr(klinesForAtr, this.atrPeriod);
        if (!atr || atr <= 0) continue;

        const sonuc = trail.instance.guncelle(
          trail.giris_fiyat,
          suanki,
          atr,
          kapanis,
        );
        trail.last4hCloseTs = closeTs;
        this.save();

        // UI için pozisyon objesine yansıt
        const pos = this.deps.getPositions().find((p) => p.instId === instId);
        if (pos && sonuc.stop_fiyat !== null) {
          pos._panelTrailingStop = sonuc.stop_fiyat;
          pos._panelTrailingCarpan = trail.instance.son_atr_carpan;
        }

        if (sonuc.cikis_sinyali && sonuc.stop_fiyat !== null) {
          await this.autoExit(instId, sonuc.stop_fiyat, kapanis);
        }
      } catch {
        // Tek pair'in hatası diğerlerini bloklamasın
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // AUTO EXIT: market close + Telegram + state cleanup
  // Kaynak: panel `_autoExit` satır 11271-11296
  // v2 EK: exitInProgress set'i ile mode geçişi koruma
  // ───────────────────────────────────────────────────────────────────

  private async autoExit(
    instId: string,
    stopPx: number,
    kapanis: number,
  ): Promise<void> {
    const pos = this.deps.getPositions().find((p) => p.instId === instId);
    if (!pos) return;

    this.exitInProgress.add(instId); // mode geçişine sinyal: bekle
    try {
      const r = await this.deps.closePosition(pos);
      if (r.ok) {
        const pfx = this.deps.isDemoMode() ? "🧪 DEMO · " : "";
        this.deps.sendTelegram?.(
          `${pfx}🛑 TRAILING STOP TETİK\n${instId}\nMum kapanış: ${kapanis.toFixed(4)}\nStop: ${stopPx.toFixed(4)}\nOtomatik kapatıldı.`,
        );
        this.deps.toast?.(`✓ Trail çıkış: ${instId}`, "ok");
        delete this.trails[instId];
        this.save();
      } else {
        // Başarısız → bir sonraki tick'te tekrar dene (cikis_tetiklendi reset)
        this.deps.toast?.(`✗ Trail çıkış başarısız: ${r.err}`, "err");
        if (this.trails[instId]) {
          this.trails[instId].instance.cikis_tetiklendi = false;
          this.save();
        }
      }
    } finally {
      this.exitInProgress.delete(instId);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // TICK: ana orchestrator
  // Kaynak: panel `trailingTick` satır 11298-11318
  // ───────────────────────────────────────────────────────────────────

  /**
   * Bir tick çalıştır. Test ve manuel debug için public.
   * Production'da `start()` ile interval'a bağlanır.
   */
  async tick(): Promise<void> {
    if (this.tickLock || this.stopped) return;
    this.tickLock = true;
    try {
      const positions = this.deps.getPositions();
      if (!Array.isArray(positions) || positions.length === 0) {
        if (Object.keys(this.trails).length > 0) this.syncTrailsWithPositions();
        return;
      }
      this.syncTrailsWithPositions();
      for (const instId of Object.keys(this.trails)) {
        if (this.stopped) break; // mode geçişi sırasında erken çık
        await this.checkRallyActivation(instId);
      }
      if (!this.stopped) await this.processTrailingStops();
    } finally {
      this.tickLock = false;
    }
  }

  /**
   * Periyodik tick'i başlat (10 sn gecikme + 30 sn interval — panel ile aynı).
   */
  start(): void {
    if (this.interval) return; // zaten çalışıyor
    this.stopped = false;
    this.initialTimer = setTimeout(() => {
      void this.tick();
    }, this.initialDelayMs);
    this.interval = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  /**
   * Tick'i durdur. Aktif tick'i bekletmez — onun için `waitForIdle()` kullan.
   */
  stop(): void {
    this.stopped = true;
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
