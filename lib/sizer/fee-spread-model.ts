/**
 * FEE & SPREAD MODEL — Adaptive Slippage + Dynamic Fee Modeling.
 *
 * Sorumluluk:
 *   1. OKX fillFee + anlık order book spread'ini alarak MARKET vs LIMIT
 *      emir moduna karar verir.
 *   2. Komisyon artışında TP fiyatını yukarı kalibre eder (fee amortismanı).
 *
 * Saf fonksiyonlar — I/O yok, yan etki yok.
 */

// ─── Sabitler ────────────────────────────────────────────────

/** Spread normal eşik — bu çarpanın üstüne çıkınca LIMIT moduna geç */
export const SPREAD_ELEVATED_MULTIPLIER = 1.5;

/** Spread çok geniş eşiği — ciddi likidite sıkışması */
export const SPREAD_WIDE_MULTIPLIER = 3.0;

/** OKX varsayılan taker fee oranı (BTC/ETH perp) */
export const DEFAULT_TAKER_FEE = 0.0005; // %0.05

/** OKX varsayılan maker fee oranı */
export const DEFAULT_MAKER_FEE = 0.0002; // %0.02

/** TP kalibrasyonu için minimum fee yükü (px'in yüzdesi) */
export const MIN_FEE_LOAD_FOR_CALIBRATION = 0.0003; // %0.03

// ─── Tipler ──────────────────────────────────────────────────

/**
 * OKX fill'den veya websocket'ten alınan komisyon bağlamı.
 */
export interface FillFeeContext {
  /** Taker fee oranı (decimal, ör. 0.0005 = %0.05) */
  takerFeeRate: number;
  /** Maker fee oranı (decimal, ör. 0.0002 = %0.02) */
  makerFeeRate: number;
  /**
   * Opsiyonel: Son fillFee (gerçek gerçekleşmiş oran).
   * Eğer verilirse takerFeeRate'i ezer — daha hassas kalibrasyon.
   */
  lastFillFeeRate?: number;
}

/**
 * Order book anlık makas bağlamı.
 */
export interface SpreadContext {
  /** Anlık bid-ask spread (mutlak, USD cinsinden) */
  currentSpread: number;
  /**
   * Normal (baseline) spread — son N periyot ortalaması.
   * Sizer'ı çağıran taraf bu değeri besler (kayan ortalama veya sabit eşik).
   */
  normalSpread: number;
}

/** Spread durum değerlendirmesi */
export type SpreadCondition = "normal" | "elevated" | "wide";

/** Emir modu kararı */
export type OrderMode = "market" | "limit";

/** Spread değerlendirme sonucu */
export interface SpreadAssessment {
  condition: SpreadCondition;
  /** currentSpread / normalSpread oranı */
  spreadRatio: number;
  /** Önerilen emir modu */
  orderMode: OrderMode;
}

/** TP kalibrasyon sonucu */
export interface FeeAdjustedTp {
  /** Orijinal TP1 fiyatı */
  originalTp1: number;
  /** Orijinal TP2 fiyatı */
  originalTp2: number;
  /** Fee amortize edilmiş TP1 */
  adjustedTp1: number;
  /** Fee amortize edilmiş TP2 */
  adjustedTp2: number;
  /** Toplam fee yükü (her iki leg: açış + kapanış, px yüzdesi) */
  totalFeeLoad: number;
  /** Kalibrasyon uygulandı mı (fee yükü eşiğin altındaysa false) */
  calibrated: boolean;
}

/** computePositionSize'a enjekte edilecek fee/spread kararı */
export interface FeeSpreadDecision {
  spread: SpreadAssessment;
  feeAdjustedTp: FeeAdjustedTp;
  /** Aktif emir modu (spread + fee kararının özeti) */
  orderMode: OrderMode;
}

// ─── Saf fonksiyonlar ─────────────────────────────────────────

/**
 * Order book spread'ini normal ile karşılaştır, emir moduna karar ver.
 *
 * - spreadRatio < SPREAD_ELEVATED_MULTIPLIER → normal → market
 * - spreadRatio < SPREAD_WIDE_MULTIPLIER     → elevated → limit
 * - spreadRatio ≥ SPREAD_WIDE_MULTIPLIER     → wide → limit (uyarı)
 */
export function assessSpread(ctx: SpreadContext): SpreadAssessment {
  if (ctx.normalSpread <= 0) {
    return { condition: "normal", spreadRatio: 1, orderMode: "market" };
  }

  const spreadRatio = ctx.currentSpread / ctx.normalSpread;

  let condition: SpreadCondition;
  let orderMode: OrderMode;

  if (spreadRatio >= SPREAD_WIDE_MULTIPLIER) {
    condition = "wide";
    orderMode = "limit";
  } else if (spreadRatio >= SPREAD_ELEVATED_MULTIPLIER) {
    condition = "elevated";
    orderMode = "limit";
  } else {
    condition = "normal";
    orderMode = "market";
  }

  return { condition, spreadRatio, orderMode };
}

/**
 * LONG/SHORT için TP fiyatını fee yüküyle kalibre et.
 *
 * Açılış + kapanış iki taraf → toplam fee yükü = 2 × effectiveFeeRate × px.
 * TP, bu maliyet kadar yukarı (LONG) veya aşağı (SHORT) kaydırılır.
 *
 * Kalibrasyon yalnızca fee yükü MIN_FEE_LOAD_FOR_CALIBRATION üzerindeyse uygulanır.
 *
 * @param direction  "LONG" | "SHORT"
 * @param px         Giriş fiyatı
 * @param tp1        Orijinal TP1 fiyatı
 * @param tp2        Orijinal TP2 fiyatı
 * @param feeCtx     Komisyon bağlamı
 * @param orderMode  Emir modu — limit ise makerFee, market ise takerFee kullanılır
 */
export function calibrateTpForFee(
  direction: "LONG" | "SHORT",
  px: number,
  tp1: number,
  tp2: number,
  feeCtx: FillFeeContext,
  orderMode: OrderMode = "market",
): FeeAdjustedTp {
  const effectiveFeeRate =
    feeCtx.lastFillFeeRate ??
    (orderMode === "limit" ? feeCtx.makerFeeRate : feeCtx.takerFeeRate);

  // İki leg (açış + kapanış) — her iki taraf da ücret öder
  const totalFeeLoad = 2 * effectiveFeeRate;

  const calibrated = totalFeeLoad >= MIN_FEE_LOAD_FOR_CALIBRATION;

  let adjustedTp1 = tp1;
  let adjustedTp2 = tp2;

  if (calibrated && px > 0) {
    const feeOffset = totalFeeLoad * px;
    if (direction === "LONG") {
      adjustedTp1 = tp1 + feeOffset;
      adjustedTp2 = tp2 + feeOffset;
    } else {
      // SHORT: TP fiyat aşağıda — fee'yi telafi etmek için daha da aşağı çek
      adjustedTp1 = tp1 - feeOffset;
      adjustedTp2 = tp2 - feeOffset;
    }
  }

  return {
    originalTp1: tp1,
    originalTp2: tp2,
    adjustedTp1,
    adjustedTp2,
    totalFeeLoad,
    calibrated,
  };
}

/**
 * Spread + fee bağlamından tek bir FeeSpreadDecision üret.
 * computePositionSize'a iletilir.
 */
export function buildFeeSpreadDecision(
  direction: "LONG" | "SHORT",
  px: number,
  tp1: number,
  tp2: number,
  spreadCtx: SpreadContext,
  feeCtx: FillFeeContext,
): FeeSpreadDecision {
  const spread = assessSpread(spreadCtx);
  const feeAdjustedTp = calibrateTpForFee(direction, px, tp1, tp2, feeCtx, spread.orderMode);

  return {
    spread,
    feeAdjustedTp,
    orderMode: spread.orderMode,
  };
}

/**
 * Varsayılan FillFeeContext — OKX standart tier.
 */
export function defaultFeeContext(): FillFeeContext {
  return {
    takerFeeRate: DEFAULT_TAKER_FEE,
    makerFeeRate: DEFAULT_MAKER_FEE,
  };
}
