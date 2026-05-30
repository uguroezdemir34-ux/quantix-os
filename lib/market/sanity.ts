/**
 * ANOMALOUS CANDLE & FLASH CRASH FILTER
 *
 * Kripto vadeli işlem piyasasında saniyelik likidasyon zincirlerinden
 * kaynaklanan sahte iğneleri (bad print / flash crash) tespit eder.
 *
 * Temel ilke:
 *   Vadeli fiyatı (perp) ani bir hareket yapıyorken spot piyasa bunu
 *   doğrulamıyorsa bu bir borsa anomalisidir — stop-loss mekanizmaları
 *   anomali süresi boyunca dondurulur (freeze).
 *
 * Tespit Katmanları:
 *   1. Basis Spike  — perp/spot sapması eşik üzerinde
 *   2. Flash Crash  — kısa pencerede perp sert düşüyor, spot sakin
 *   3. Flash Pump   — kısa pencerede perp sert çıkıyor, spot sakin
 *   4. Unconfirmed  — perp değişimi spot değişiminin çok üzerinde
 *
 * Dondurma (Freeze):
 *   Anomali tespit edildiğinde `freezeSl=true` döner.
 *   Caller bu flag'i okuyup TP/SL tetiklemelerini o süreye askıya alır.
 *   Freeze süresi configüre edilebilir (varsayılan: 10 sn).
 *
 * Saf fonksiyonlar — I/O yok, yan etki yok.
 * Durum (state) caller tarafında tutulur; bu modül değerlendirme yapar.
 */

// ─── Sabitler ────────────────────────────────────────────────

/** Varsayılan basis spike eşiği — perp/spot farkı bu yüzdeyi geçerse anomali */
export const DEFAULT_BASIS_SPIKE_PCT = 0.5; // %0.5

/** Çok geniş basis eşiği — ciddi anomali */
export const DEFAULT_BASIS_EXTREME_PCT = 1.5; // %1.5

/** Kısa pencere fiyat değişimi eşiği — perp bu yüzdeden fazla hareket etmeli */
export const DEFAULT_PERP_MOVE_PCT = 1.0; // %1.0

/**
 * Spot onay oranı eşiği.
 * spotMovePct / perpMovePct < bu değer → "spot doğrulamadı"
 */
export const DEFAULT_CONFIRMATION_RATIO = 0.25;

/** Varsayılan freeze süresi (ms) */
export const DEFAULT_FREEZE_DURATION_MS = 10_000; // 10 saniye

/** Varsayılan analiz penceresi (ms) — son kaç ms'deki anlık verileri incele */
export const DEFAULT_ANALYSIS_WINDOW_MS = 3_000; // 3 saniye

/** Maksimum tutulacak snapshot sayısı */
export const MAX_SNAPSHOT_HISTORY = 200;

// ─── Tipler ──────────────────────────────────────────────────

/** Anlık çift fiyat okuması (perp + spot) */
export interface PriceSnapshot {
  /** Epoch ms */
  timestamp: number;
  /** Vadeli işlem (perpetual) fiyatı */
  perpPrice: number;
  /** Spot piyasa fiyatı */
  spotPrice: number;
}

/** Anomali türleri */
export type AnomalyType =
  | "basis_spike"       // Perp/spot sapması eşik üzerinde
  | "basis_extreme"     // Perp/spot sapması çok kritik seviyede
  | "flash_crash"       // Kısa sürede perp sert düşüş, spot sakin
  | "flash_pump"        // Kısa sürede perp sert çıkış, spot sakin
  | "unconfirmed_move"  // Perp hareketi spot tarafından doğrulanmadı
  | "none";

/** Sanity filter durum seviyesi */
export type SanityLevel =
  | "ok"          // Her şey normal
  | "suspicious"  // Dikkat — izle
  | "anomaly"     // Anomali tespit edildi — SL dondur
  | "extreme";    // Kritik anomali — SL dondur + uyar

/** Tek bir sanity değerlendirme sonucu */
export interface SanityResult {
  /** Değerlendirme zamanı */
  timestamp: number;
  /** Sonuç seviyesi */
  level: SanityLevel;
  /** Ana anomali türü */
  anomalyType: AnomalyType;
  /** Anlık basis yüzdesi — (perp - spot) / spot × 100 */
  basisPct: number;
  /** Pencere içindeki perp hareketi (yüzde, signed) */
  perpMovePct: number;
  /** Pencere içindeki spot hareketi (yüzde, signed) */
  spotMovePct: number;
  /** spotMovePct / perpMovePct — 1.0 = tam onay, 0.0 = sıfır onay */
  confirmationRatio: number | null;
  /** Stop-loss mekanizmaları dondurulsun mu? */
  freezeSl: boolean;
  /** Dondurma bitiş zamanı (epoch ms) — freezeSl=true ise geçerli */
  freezeUntil: number | null;
}

/** SanityFilter konfigürasyonu */
export interface SanityConfig {
  /**
   * Basis spike eşiği (%).
   * Default: 0.5
   */
  basisSpikePct?: number;
  /**
   * Çok geniş basis eşiği (%).
   * Default: 1.5
   */
  basisExtremePct?: number;
  /**
   * Anomali tespiti için minimum perp hareketi (%).
   * Bu eşiğin altındaki hareketler "küçük gürültü" sayılır, unconfirmed filtre uygulanmaz.
   * Default: 1.0
   */
  perpMovePct?: number;
  /**
   * Spot onay oranı eşiği (0–1).
   * spotMove / perpMove bu değerin altındaysa anomali.
   * Default: 0.25
   */
  confirmationRatio?: number;
  /**
   * Freeze süresi (ms).
   * Default: 10_000
   */
  freezeDurationMs?: number;
  /**
   * Analiz penceresi (ms) — kaç ms geriye bakılacak.
   * Default: 3_000
   */
  analysisWindowMs?: number;
}

/** Freeze durumu — caller'ın saklaması gereken state */
export interface FreezeState {
  /** Freeze aktif mi? */
  active: boolean;
  /** Freeze bitiş zamanı (epoch ms) — active=false ise null */
  until: number | null;
  /** Freeze tetikleyen anomali türü */
  triggeredBy: AnomalyType | null;
  /** Freeze tetiklenme zamanı */
  triggeredAt: number | null;
}

// ─── Saf hesaplama fonksiyonları ─────────────────────────────

/**
 * Anlık basis yüzdesini hesapla.
 * basis = (perpPrice - spotPrice) / spotPrice × 100
 *
 * Pozitif: Perp primli (contango).
 * Negatif: Perp iskontolu (backwardation).
 */
export function computeBasis(perpPrice: number, spotPrice: number): number {
  if (spotPrice <= 0) return 0;
  return ((perpPrice - spotPrice) / spotPrice) * 100;
}

/**
 * İki fiyat noktası arasındaki yüzdesel değişimi hesapla.
 */
export function computeChangePct(from: number, to: number): number {
  if (from <= 0) return 0;
  return ((to - from) / from) * 100;
}

/**
 * Snapshot geçmişinden analiz penceresine giren snapshot'ları filtrele.
 */
export function filterWindow(
  snapshots: readonly PriceSnapshot[],
  nowMs: number,
  windowMs: number,
): PriceSnapshot[] {
  const cutoff = nowMs - windowMs;
  return snapshots.filter((s) => s.timestamp >= cutoff);
}

/**
 * Pencere içindeki en eski ve en yeni snapshot'ı al.
 * Minimum 2 snapshot gerekir.
 */
export function getWindowEdges(
  window: readonly PriceSnapshot[],
): { oldest: PriceSnapshot; newest: PriceSnapshot } | null {
  if (window.length < 2) return null;
  // timestamp'e göre sıralı varsayıyoruz; güvenli taraf için min/max bul
  let oldest = window[0];
  let newest = window[0];
  for (const s of window) {
    if (s.timestamp < oldest.timestamp) oldest = s;
    if (s.timestamp > newest.timestamp) newest = s;
  }
  return { oldest, newest };
}

/**
 * Spot onay oranını hesapla.
 * perpMovePct ve spotMovePct aynı yönde mi, onay ne kadar güçlü?
 *
 * Kurallar:
 * - perpMovePct sıfıra çok yakınsa → null (bölme yapma)
 * - Yönler ters ise → 0.0 (tam ters hareket = sıfır onay)
 * - Aynı yönde → |spotMove| / |perpMove| (1.0 = tam onay)
 */
export function computeConfirmationRatio(
  perpMovePct: number,
  spotMovePct: number,
): number | null {
  if (Math.abs(perpMovePct) < 0.01) return null; // çok küçük hareket

  // Yönler ters → onay sıfır
  if (perpMovePct > 0 && spotMovePct < 0) return 0;
  if (perpMovePct < 0 && spotMovePct > 0) return 0;

  const ratio = Math.abs(spotMovePct) / Math.abs(perpMovePct);
  // 1.0 üzerini kısıt (spot daha fazla hareket etmişse = fazla onay, sorun yok)
  return Math.min(ratio, 1.0);
}

/**
 * Tek bir PriceSnapshot çiftiyle anlık sanity değerlendirmesi yap.
 *
 * Bu fonksiyon yalnızca basis spike ve extreme kontrolü yapar.
 * Pencere analizi için `evaluateSanityWindow()` kullan.
 */
export function evaluateBasis(
  snapshot: PriceSnapshot,
  cfg: Required<SanityConfig>,
): { level: SanityLevel; anomalyType: AnomalyType; basisPct: number } {
  const basisPct = computeBasis(snapshot.perpPrice, snapshot.spotPrice);
  const absBasis = Math.abs(basisPct);

  if (absBasis >= cfg.basisExtremePct) {
    return { level: "extreme", anomalyType: "basis_extreme", basisPct };
  }
  if (absBasis >= cfg.basisSpikePct) {
    return { level: "anomaly", anomalyType: "basis_spike", basisPct };
  }

  return { level: "ok", anomalyType: "none", basisPct };
}

/**
 * Pencere analizi — kısa sürede perp hareketi vs spot onayı.
 *
 * Tespit:
 *   - flash_crash: perp sert düşüyor (< -perpMovePct) + spot doğrulamıyor
 *   - flash_pump: perp sert çıkıyor (> +perpMovePct) + spot doğrulamıyor
 *   - unconfirmed_move: büyük perp hareketi, spot onayı zayıf
 */
export function evaluateMovement(
  edges: { oldest: PriceSnapshot; newest: PriceSnapshot },
  cfg: Required<SanityConfig>,
): {
  level: SanityLevel;
  anomalyType: AnomalyType;
  perpMovePct: number;
  spotMovePct: number;
  confirmationRatio: number | null;
} {
  const perpMovePct = computeChangePct(
    edges.oldest.perpPrice,
    edges.newest.perpPrice,
  );
  const spotMovePct = computeChangePct(
    edges.oldest.spotPrice,
    edges.newest.spotPrice,
  );

  const absPerp = Math.abs(perpMovePct);

  // Perp hareketi eşiğin altındaysa hareket analizi yapmaya gerek yok
  if (absPerp < cfg.perpMovePct) {
    return {
      level: "ok",
      anomalyType: "none",
      perpMovePct,
      spotMovePct,
      confirmationRatio: null,
    };
  }

  const confirmationRatio = computeConfirmationRatio(perpMovePct, spotMovePct);

  // Onay oranı eşiğin altındaysa anomali
  if (confirmationRatio !== null && confirmationRatio < cfg.confirmationRatio) {
    let anomalyType: AnomalyType;
    if (perpMovePct < 0) {
      anomalyType = "flash_crash";
    } else if (perpMovePct > 0) {
      anomalyType = "flash_pump";
    } else {
      anomalyType = "unconfirmed_move";
    }
    return {
      level: "anomaly",
      anomalyType,
      perpMovePct,
      spotMovePct,
      confirmationRatio,
    };
  }

  // Hareket büyük ama onay zayıf (eşiğin hemen üstünde) → suspicious
  if (
    confirmationRatio !== null &&
    confirmationRatio < cfg.confirmationRatio * 2
  ) {
    return {
      level: "suspicious",
      anomalyType: "unconfirmed_move",
      perpMovePct,
      spotMovePct,
      confirmationRatio,
    };
  }

  return {
    level: "ok",
    anomalyType: "none",
    perpMovePct,
    spotMovePct,
    confirmationRatio,
  };
}

/**
 * Ana değerlendirme — tek snapshot + geçmiş penceresi.
 *
 * Katman önceliği:
 *   1. basis_extreme → level=extreme (en kritik)
 *   2. flash_crash / flash_pump → level=anomaly
 *   3. basis_spike → level=anomaly
 *   4. unconfirmed_move → level=anomaly
 *   5. suspicious → level=suspicious
 *   6. ok
 */
export function evaluateSanity(
  current: PriceSnapshot,
  history: readonly PriceSnapshot[],
  cfg: SanityConfig = {},
  now: number = current.timestamp,
): SanityResult {
  const resolved = resolveCfg(cfg);

  // Basis kontrolü (anlık)
  const basisEval = evaluateBasis(current, resolved);

  // Pencere analizi
  const window = filterWindow(history, now, resolved.analysisWindowMs);
  // Güncel snapshot'ı pencereye ekle
  const windowWithCurrent = [...window, current];
  const edges = getWindowEdges(windowWithCurrent);

  const movementEval = edges
    ? evaluateMovement(edges, resolved)
    : {
        level: "ok" as SanityLevel,
        anomalyType: "none" as AnomalyType,
        perpMovePct: 0,
        spotMovePct: 0,
        confirmationRatio: null,
      };

  // En yüksek seviyeyi seç
  const finalLevel = maxLevel(basisEval.level, movementEval.level);

  // Anomali türü: extreme > flash > basis_spike > unconfirmed
  let anomalyType: AnomalyType = "none";
  if (finalLevel !== "ok") {
    if (basisEval.anomalyType === "basis_extreme") {
      anomalyType = "basis_extreme";
    } else if (
      movementEval.anomalyType === "flash_crash" ||
      movementEval.anomalyType === "flash_pump"
    ) {
      anomalyType = movementEval.anomalyType;
    } else if (basisEval.anomalyType === "basis_spike") {
      anomalyType = "basis_spike";
    } else {
      anomalyType = movementEval.anomalyType;
    }
  }

  const shouldFreeze = finalLevel === "anomaly" || finalLevel === "extreme";
  const freezeUntil = shouldFreeze ? now + resolved.freezeDurationMs : null;

  return {
    timestamp: now,
    level: finalLevel,
    anomalyType,
    basisPct: basisEval.basisPct,
    perpMovePct: movementEval.perpMovePct,
    spotMovePct: movementEval.spotMovePct,
    confirmationRatio: movementEval.confirmationRatio,
    freezeSl: shouldFreeze,
    freezeUntil,
  };
}

// ─── FreezeState yardımcıları ─────────────────────────────────

/**
 * Boş (aktif olmayan) FreezeState oluştur.
 */
export function createFreezeState(): FreezeState {
  return { active: false, until: null, triggeredBy: null, triggeredAt: null };
}

/**
 * SanityResult'dan FreezeState güncelle.
 *
 * Mevcut freeze aktifse ve yeni anomali geldiyse süreyi uzat (en uzun kazanır).
 * Freeze süresi dolduysa (now > until) otomatik serbest bırak.
 */
export function updateFreezeState(
  current: FreezeState,
  result: SanityResult,
  now: number = result.timestamp,
): FreezeState {
  // Mevcut freeze süresi dolmuşsa sıfırla
  const expired = current.active && current.until !== null && now >= current.until;
  const base: FreezeState = expired
    ? createFreezeState()
    : current;

  if (!result.freezeSl) return base;

  // Yeni anomali — freeze süresini güncelle (en geç bitiş zamanı)
  const newUntil = result.freezeUntil!;
  const extendedUntil =
    base.active && base.until !== null
      ? Math.max(base.until, newUntil)
      : newUntil;

  return {
    active: true,
    until: extendedUntil,
    triggeredBy: result.anomalyType,
    triggeredAt: base.triggeredAt ?? now,
  };
}

/**
 * Freeze aktif mi? now verilerek kontrol et.
 */
export function isFreezeActive(state: FreezeState, now: number): boolean {
  if (!state.active || state.until === null) return false;
  return now < state.until;
}

/**
 * Snapshot geçmişine yeni kayıt ekle, MAX_SNAPSHOT_HISTORY'yi geç.
 * En eski kayıtlar atılır.
 */
export function appendSnapshot(
  history: readonly PriceSnapshot[],
  snapshot: PriceSnapshot,
): PriceSnapshot[] {
  const next = [...history, snapshot];
  if (next.length > MAX_SNAPSHOT_HISTORY) {
    return next.slice(next.length - MAX_SNAPSHOT_HISTORY);
  }
  return next;
}

// ─── Yardımcı ────────────────────────────────────────────────

function resolveCfg(cfg: SanityConfig): Required<SanityConfig> {
  return {
    basisSpikePct: cfg.basisSpikePct ?? DEFAULT_BASIS_SPIKE_PCT,
    basisExtremePct: cfg.basisExtremePct ?? DEFAULT_BASIS_EXTREME_PCT,
    perpMovePct: cfg.perpMovePct ?? DEFAULT_PERP_MOVE_PCT,
    confirmationRatio: cfg.confirmationRatio ?? DEFAULT_CONFIRMATION_RATIO,
    freezeDurationMs: cfg.freezeDurationMs ?? DEFAULT_FREEZE_DURATION_MS,
    analysisWindowMs: cfg.analysisWindowMs ?? DEFAULT_ANALYSIS_WINDOW_MS,
  };
}

const LEVEL_ORDER: Record<SanityLevel, number> = {
  ok: 0,
  suspicious: 1,
  anomaly: 2,
  extreme: 3,
};

function maxLevel(a: SanityLevel, b: SanityLevel): SanityLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}
