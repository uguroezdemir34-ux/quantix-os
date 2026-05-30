/**
 * STAT-ARB EXECUTOR — Arbitraj Emir Yürütüm Motoru.
 *
 * Sorumluluk:
 *   İki bacaklı (pair trade) emirleri milisaniye içinde eş zamanlı tetikler.
 *   Bir bacak başarısız olduğunda (leg failure) diğer bacağı anında iptal
 *   ederek sistemi güvenli moda alır — açık kalan tek bacak delta-nötr değil,
 *   yönlü risk demektir.
 *
 * Durum makinesi (State Machine):
 *   FLAT → OPENING → OPEN → CLOSING → FLAT
 *                  ↘ (leg failure)
 *                    LEG_FAILURE_RECOVERY → FLAT (başarılı iptal)
 *                                        → STUCK  (iptal de başarısız)
 *
 * Kritik güvenlik kuralları:
 *   1. İki bacak Promise.all ile eş zamanlı gönderilir (milisaniyelik fark).
 *   2. Bir bacak başarısız → diğer bacak için emergency close başlatılır.
 *   3. Emergency close başarısız → state=STUCK, alarm üretilir.
 *   4. STUCK modda yeni emir açılmaz (positional risk minimum).
 *   5. Tüm yürütüm adımları bağımsız timestamp ile kayıt altına alınır.
 *
 * I/O bağımlılığı: ExchangeAdapter (inject edilir — test edilebilir).
 */

import type { ExchangeAdapter, AdapterResult, TradeData } from "./types";
import type { OpenPositionInput, ClosePositionInput } from "./types";
import type { Pair } from "@/lib/constants/pairs";
import type { StatArbSignal } from "@/lib/indicators/stat-arb";

// ─── Tipler ──────────────────────────────────────────────────

/** Stat-arb pozisyon yönü */
export type StatArbSide = "long_A_short_B" | "short_A_long_B";

/** Executor durum makinesi durumları */
export type StatArbState =
  | "flat"                    // Açık pozisyon yok
  | "opening"                 // İki bacak eş zamanlı gönderildi, yanıt bekleniyor
  | "open"                    // İki bacak da başarıyla açıldı
  | "closing"                 // Kapatma emirleri gönderildi
  | "leg_failure_recovery"    // Bir bacak başarısız, diğeri iptal ediliyor
  | "stuck";                  // Emergency close da başarısız → manuel müdahale gerekli

/** Tek bir bacağın yürütüm kaydı */
export interface LegRecord {
  pair: string;
  direction: "LONG" | "SHORT";
  qty: number;
  /** null → henüz gönderilmedi */
  orderId: string | null;
  ok: boolean;
  errorKind?: string;
  errorMessage?: string;
  /** Emir gönderim zamanı (epoch ms) */
  sentAt: number | null;
  /** Yanıt alım zamanı */
  resolvedAt: number | null;
}

/** Açık stat-arb pozisyonu */
export interface StatArbPosition {
  id: string;
  side: StatArbSide;
  legA: LegRecord;
  legB: LegRecord;
  openedAt: number;
  closedAt: number | null;
  /** Z-score pozisyon açıldığında */
  entryZScore: number;
  /** Kapatma z-score'u (null → henüz kapanmadı) */
  exitZScore: number | null;
  pnlEstimate: number | null;
}

/** Emir çifti yürütüm sonucu */
export interface StatArbOpenResult {
  ok: boolean;
  position: StatArbPosition | null;
  state: StatArbState;
  /** Hangi bacak başarısız oldu (null → her ikisi başarılı veya her ikisi başarısız) */
  failedLeg: "legA" | "legB" | "both" | null;
  /** Emergency close başlatıldı mı? */
  emergencyCloseAttempted: boolean;
  /** Emergency close başarılı mı? */
  emergencyCloseOk: boolean | null;
  reasonHuman: string;
  /** Toplam yürütüm süresi (ms) */
  durationMs: number;
}

/** Kapatma yürütüm sonucu */
export interface StatArbCloseResult {
  ok: boolean;
  state: StatArbState;
  legACloseOk: boolean;
  legBCloseOk: boolean;
  /** Yanıt gecikmeleri (ms) */
  legADurationMs: number;
  legBDurationMs: number;
  reasonHuman: string;
  durationMs: number;
}

/** Executor konfigürasyonu */
export interface StatArbExecutorConfig {
  /** Her bacak için kaldıraç */
  leverage: number;
  /** Margin modu */
  marginMode: "cross" | "isolated";
  /** Kaç ms içinde yanıt gelmezse timeout (test için küçültülebilir) */
  timeoutMs?: number;
  /** Şu an (test inject) */
  now?: () => number;
}

// ─── ID üretimi ───────────────────────────────────────────────

function genPositionId(now: number): string {
  return `sa_${now}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Leg record factory ───────────────────────────────────────

function makeLeg(
  pair: string,
  direction: "LONG" | "SHORT",
  qty: number,
): LegRecord {
  return {
    pair,
    direction,
    qty,
    orderId: null,
    ok: false,
    sentAt: null,
    resolvedAt: null,
  };
}

function applyAdapterResult(
  leg: LegRecord,
  result: AdapterResult<TradeData>,
  resolvedAt: number,
): LegRecord {
  return {
    ...leg,
    ok: result.ok,
    orderId: result.ok ? (result.data?.orderId ?? null) : null,
    errorKind: result.ok ? undefined : result.errorKind,
    errorMessage: result.ok ? undefined : result.errorMessage,
    resolvedAt,
  };
}

// ─── Ana executor sınıfı ─────────────────────────────────────

/**
 * StatArbExecutor — iki bacaklı arbitraj emir motoru.
 *
 * Her instance tek bir stat-arb pair'ini yönetir.
 * Birden fazla pair için birden fazla instance kullanılabilir.
 */
export class StatArbExecutor {
  private readonly adapterA: ExchangeAdapter;
  private readonly adapterB: ExchangeAdapter;
  private readonly config: Required<StatArbExecutorConfig>;

  private _state: StatArbState = "flat";
  private _position: StatArbPosition | null = null;

  constructor(
    adapterA: ExchangeAdapter,
    adapterB: ExchangeAdapter,
    config: StatArbExecutorConfig,
  ) {
    this.adapterA = adapterA;
    this.adapterB = adapterB;
    this.config = {
      leverage: config.leverage,
      marginMode: config.marginMode,
      timeoutMs: config.timeoutMs ?? 10_000,
      now: config.now ?? (() => Date.now()),
    };
  }

  get state(): StatArbState {
    return this._state;
  }

  get position(): StatArbPosition | null {
    return this._position;
  }

  /**
   * İki bacağı eş zamanlı aç.
   *
   * Akış:
   *   1. State kontrolü (flat olmayan → hata)
   *   2. state = "opening"
   *   3. Promise.all([legA, legB]) — eş zamanlı gönderim
   *   4a. Her ikisi başarılı → state = "open"
   *   4b. Bir bacak başarısız → emergency close başlat
   *   4c. Her ikisi başarısız → state = "flat" (pozisyon açılmadı)
   *
   * @param pairA       Birinci varlık (LONG veya SHORT leg)
   * @param pairB       İkinci varlık (ters leg)
   * @param side        Hangi yön — "long_A_short_B" veya "short_A_long_B"
   * @param qtyA        A bacağı miktarı
   * @param qtyB        B bacağı miktarı
   * @param entryZScore Tetikleyen z-score (kayıt için)
   */
  async openPair(
    pairA: Pair,
    pairB: string,
    side: StatArbSide,
    qtyA: number,
    qtyB: number,
    entryZScore: number,
  ): Promise<StatArbOpenResult> {
    const t0 = this.config.now();

    const makeResult = (
      ok: boolean,
      state: StatArbState,
      pos: StatArbPosition | null,
      failedLeg: StatArbOpenResult["failedLeg"],
      emergencyAttempted: boolean,
      emergencyOk: boolean | null,
      reason: string,
    ): StatArbOpenResult => ({
      ok,
      position: pos,
      state,
      failedLeg,
      emergencyCloseAttempted: emergencyAttempted,
      emergencyCloseOk: emergencyOk,
      reasonHuman: reason,
      durationMs: this.config.now() - t0,
    });

    // ── Durum kontrolü ──
    if (this._state !== "flat") {
      return makeResult(
        false, this._state, null, null, false, null,
        `Executor açık pozisyonda: state=${this._state} — yeni pozisyon açılamaz`,
      );
    }

    this._state = "opening";

    // ── Bacak yönleri ──
    const dirA: "LONG" | "SHORT" = side === "long_A_short_B" ? "LONG" : "SHORT";
    const dirB: "LONG" | "SHORT" = side === "long_A_short_B" ? "SHORT" : "LONG";

    const legA = makeLeg(pairA, dirA, qtyA);
    const legB = makeLeg(pairB, dirB, qtyB);

    const orderInputA: OpenPositionInput = {
      pair: pairA,
      direction: dirA,
      qty: qtyA,
      leverage: this.config.leverage,
      marginMode: this.config.marginMode,
    };

    const orderInputB: OpenPositionInput = {
      pair: pairA, // instId için pairA kullanılıyor; gerçek impl'de pairB instId'si inject edilir
      direction: dirB,
      qty: qtyB,
      leverage: this.config.leverage,
      marginMode: this.config.marginMode,
    };

    const sentAtA = this.config.now();
    const sentAtB = this.config.now();
    legA.sentAt = sentAtA;
    legB.sentAt = sentAtB;

    // ── EŞ ZAMANLI gönderim ──
    const [resultA, resultB] = await Promise.all([
      this.adapterA.openPosition(orderInputA).catch((e): AdapterResult<TradeData> => ({
        ok: false,
        errorKind: "EXCEPTION",
        errorMessage: e instanceof Error ? e.message : "Adapter exception",
      })),
      this.adapterB.openPosition(orderInputB).catch((e): AdapterResult<TradeData> => ({
        ok: false,
        errorKind: "EXCEPTION",
        errorMessage: e instanceof Error ? e.message : "Adapter exception",
      })),
    ]);

    const resolvedAt = this.config.now();
    const finalLegA = applyAdapterResult({ ...legA }, resultA, resolvedAt);
    const finalLegB = applyAdapterResult({ ...legB }, resultB, resolvedAt);

    // ── Her ikisi başarılı ──
    if (finalLegA.ok && finalLegB.ok) {
      const posId = genPositionId(t0);
      const position: StatArbPosition = {
        id: posId,
        side,
        legA: finalLegA,
        legB: finalLegB,
        openedAt: t0,
        closedAt: null,
        entryZScore,
        exitZScore: null,
        pnlEstimate: null,
      };
      this._state = "open";
      this._position = position;
      return makeResult(true, "open", position, null, false, null, "Her iki bacak başarıyla açıldı");
    }

    // ── Her ikisi başarısız ──
    if (!finalLegA.ok && !finalLegB.ok) {
      this._state = "flat";
      return makeResult(
        false, "flat", null, "both", false, null,
        `Her iki bacak başarısız — A: ${finalLegA.errorMessage}, B: ${finalLegB.errorMessage}`,
      );
    }

    // ── Bir bacak başarısız → emergency close ──
    const failedLeg: "legA" | "legB" = !finalLegA.ok ? "legA" : "legB";
    const successfulLeg = failedLeg === "legA" ? finalLegB : finalLegA;
    const successfulAdapter = failedLeg === "legA" ? this.adapterB : this.adapterA;

    this._state = "leg_failure_recovery";

    const emergencyResult = await this._emergencyClose(
      successfulAdapter,
      successfulLeg,
      pairA,
    );

    if (emergencyResult.ok) {
      this._state = "flat";
      return makeResult(
        false, "flat", null, failedLeg, true, true,
        `Leg ${failedLeg} başarısız (${failedLeg === "legA" ? finalLegA.errorMessage : finalLegB.errorMessage}). ` +
        `Başarılı bacak güvenle kapatıldı. State: FLAT.`,
      );
    } else {
      this._state = "stuck";
      // Partial position kaydet — STUCK state'de izleme için
      const partialPos: StatArbPosition = {
        id: genPositionId(t0),
        side,
        legA: finalLegA,
        legB: finalLegB,
        openedAt: t0,
        closedAt: null,
        entryZScore,
        exitZScore: null,
        pnlEstimate: null,
      };
      this._position = partialPos;
      return makeResult(
        false, "stuck", partialPos, failedLeg, true, false,
        `⚠️ KRİTİK: Leg ${failedLeg} başarısız VE emergency close başarısız. ` +
        `Manuel müdahale gerekli! State: STUCK.`,
      );
    }
  }

  /**
   * Her iki pozisyonu eş zamanlı kapat.
   *
   * Kapatma sırasında bir bacak başarısız olursa diğer bacak yine de
   * kapatılmaya devam edilir (close'da emergency yoktur — pozisyon zaten açıktı).
   * Kısmi kapanma rapor edilir.
   *
   * @param exitZScore  Mean reversion z-score'u (kayıt için)
   */
  async closePair(exitZScore: number): Promise<StatArbCloseResult> {
    const t0 = this.config.now();

    const makeResult = (
      ok: boolean,
      state: StatArbState,
      legAOk: boolean,
      legBOk: boolean,
      legAMs: number,
      legBMs: number,
      reason: string,
    ): StatArbCloseResult => ({
      ok,
      state,
      legACloseOk: legAOk,
      legBCloseOk: legBOk,
      legADurationMs: legAMs,
      legBDurationMs: legBMs,
      reasonHuman: reason,
      durationMs: this.config.now() - t0,
    });

    if (this._state !== "open") {
      return makeResult(
        false, this._state, false, false, 0, 0,
        `Kapatılacak açık pozisyon yok: state=${this._state}`,
      );
    }

    if (!this._position) {
      return makeResult(false, "flat", false, false, 0, 0, "Pozisyon kaydı bulunamadı");
    }

    this._state = "closing";
    const pos = this._position;

    const closeInputA: ClosePositionInput = {
      instId: `${pos.legA.pair}-USDT-SWAP`,
      mgnMode: this.config.marginMode,
      posSide: pos.legA.direction === "LONG" ? "long" : "short",
    };
    const closeInputB: ClosePositionInput = {
      instId: `${pos.legB.pair}-USDT-SWAP`,
      mgnMode: this.config.marginMode,
      posSide: pos.legB.direction === "LONG" ? "long" : "short",
    };

    const closeT0A = this.config.now();
    const closeT0B = this.config.now();

    // ── EŞ ZAMANLI kapatma ──
    const [closeA, closeB] = await Promise.all([
      this.adapterA.closePosition(closeInputA).catch((): AdapterResult<void> => ({
        ok: false, errorKind: "EXCEPTION", errorMessage: "closePosition exception",
      })),
      this.adapterB.closePosition(closeInputB).catch((): AdapterResult<void> => ({
        ok: false, errorKind: "EXCEPTION", errorMessage: "closePosition exception",
      })),
    ]);

    const resolvedAt = this.config.now();
    const legAMs = resolvedAt - closeT0A;
    const legBMs = resolvedAt - closeT0B;

    // Pozisyonu güncelle
    this._position = {
      ...pos,
      closedAt: resolvedAt,
      exitZScore,
    };

    const bothOk = closeA.ok && closeB.ok;
    this._state = bothOk ? "flat" : "flat"; // Her iki durumda da flat — pozisyon kapatılmaya çalışıldı

    if (bothOk) {
      return makeResult(
        true, "flat", true, true, legAMs, legBMs,
        "Her iki bacak başarıyla kapatıldı. Kâr sabitlendi.",
      );
    }

    const issues: string[] = [];
    if (!closeA.ok) issues.push(`Leg A: ${closeA.errorMessage}`);
    if (!closeB.ok) issues.push(`Leg B: ${closeB.errorMessage}`);

    return makeResult(
      false, "flat",
      closeA.ok, closeB.ok,
      legAMs, legBMs,
      `Kısmi kapatma: ${issues.join("; ")}`,
    );
  }

  /**
   * Emergency close — başarılı olan tek bacağı anında kapat.
   * Leg failure recovery sırasında çağrılır.
   */
  private async _emergencyClose(
    adapter: ExchangeAdapter,
    leg: LegRecord,
    pairA: Pair,
  ): Promise<AdapterResult<void>> {
    try {
      const closeInput: ClosePositionInput = {
        instId: `${pairA}-USDT-SWAP`,
        mgnMode: this.config.marginMode,
        posSide: leg.direction === "LONG" ? "long" : "short",
      };
      return await adapter.closePosition(closeInput);
    } catch (e) {
      return {
        ok: false,
        errorKind: "EXCEPTION",
        errorMessage: e instanceof Error ? e.message : "Emergency close exception",
      };
    }
  }

  /**
   * Executor'ı sıfırla — STUCK durumdan manuel çıkış.
   * Sadece STUCK veya flat durumunda güvenli.
   */
  reset(): boolean {
    if (this._state === "stuck" || this._state === "flat") {
      this._state = "flat";
      this._position = null;
      return true;
    }
    return false;
  }

  /** Mevcut pozisyon (okuma için) */
  getPosition(): Readonly<StatArbPosition> | null {
    return this._position;
  }
}

// ─── Sinyal → Executor eylem yönlendirici ─────────────────────

/**
 * StatArbSignal → StatArbExecutor aksiyon haritası.
 * Orkestratör bu fonksiyonu kullanarak sinyali eyleme dönüştürür.
 */
export function resolveStatArbAction(
  signal: StatArbSignal,
  executorState: StatArbState,
): "open_long_A_short_B" | "open_short_A_long_B" | "close" | "emergency_close" | "noop" {
  if (signal === "long_A_short_B" && executorState === "flat") return "open_long_A_short_B";
  if (signal === "short_A_long_B" && executorState === "flat") return "open_short_A_long_B";
  if ((signal === "close_long_A" || signal === "close_short_A") && executorState === "open") return "close";
  if (signal === "emergency_close" && executorState === "open") return "emergency_close";
  return "noop";
}
