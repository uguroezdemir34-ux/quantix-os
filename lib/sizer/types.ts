/**
 * SIZER TYPES — Position sizing ortak tipleri.
 *
 * Tasarım kuralı: i18n-ready. UI'a metin döndürmüyoruz — kategori/kind enum
 * döndürüyoruz, UI tarafı locale'e göre çevirir. label alanı şimdilik TR
 * default, ama enum üzerinden lookup yapılabilir.
 */

import type { Direction } from "@/lib/score/orchestrator";

export interface StopResult {
  stopPrice: number;
  stopDistance: number;
  /** Stop türü — i18n için key */
  kind:
    | "structural" // Yapısal swing
    | "widened" // Yapı genişletildi (1.0× ATR)
    | "atr_no_pivot" // Pivot yok, ATR fallback
    | "atr_invalid_pivot" // Pivot yanlış tarafta
    | "atr_too_far"; // Pivot çok uzak
  /** UI için açıklama (i18n eklenince enum üstünden lookup) */
  label: string;
  /** Hangi swing seviyesi kullanıldı (varsa) */
  swingLevel: number | null;
}

export interface TpResult {
  tp1Price: number;
  tp2Price: number;
  tp1Mult: number;
  tp2Mult: number;
  /** TP mode — i18n için key */
  mode: "weak" | "healthy" | "strong" | "healthy_fallback";
  label: string;
}

export interface RiskResult {
  /** Risk yüzdesi (decimal, 0.005 = %0.5) */
  riskPct: number;
  /** Risk USD karşılığı */
  riskUsd: number;
  /** Bucket etkisi (yoksa 1.0) */
  bucketAdj: number;
  /** Drawdown etkisi (yoksa 1.0) */
  ddAdj: number;
  /** Baz risk yüzdesi (bakiye bazlı) */
  baseRiskPct: number;
}

export interface PositionSizerInput {
  pair: string;
  direction: Direction;
  /** Anlık fiyat (entry varsayılan) */
  px: number;
  atr: number;
  /** Son 1h ADX (TP için) */
  adx1h: number | null;
  /** Yapısal swing seviyeleri (varsa) */
  swingLow: number | null;
  swingHigh: number | null;
  /** Hesap bakiyesi total + free */
  balance: { total: number; free: number };
  /** Drawdown protokol */
  drawdownProtocol: {
    tier: "normal" | "caution" | "restricted" | "locked";
    multiplier: number;
    label: string;
  };
  /** Bucket istatistikleri (sub) */
  bucket: {
    n: number;
    wr: number | null;
    isCut: boolean;
    isBoost: boolean;
    hasData: boolean;
    min: number;
    max: number;
  };
  /** Skor (bucket lookup zaten yapıldı, sizer için info) */
  score: number;
  /**
   * Opsiyonel komisyon bağlamı — OKX'ten alınan anlık fee oranları.
   * Verilirse TP fee-amortize edilir.
   */
  feeContext?: {
    takerFeeRate: number;
    makerFeeRate: number;
    lastFillFeeRate?: number;
  };
  /**
   * Opsiyonel order book spread bağlamı.
   * Verilirse MARKET/LIMIT modu dinamik olarak seçilir.
   */
  spreadContext?: {
    currentSpread: number;
    normalSpread: number;
  };
}

export interface PositionSizerResult {
  pair: string;
  direction: Direction;
  px: number;
  /** Stop */
  stop: StopResult;
  /** Take Profit */
  tp: TpResult;
  /** Risk hesabı */
  risk: RiskResult;
  /** Pozisyon büyüklüğü (coin cinsi) */
  qty: number;
  /** Notional (USD) — qty × px */
  notional: number;
  /** Önerilen kaldıraç */
  leverage: number;
  /** Gerekli margin (notional / leverage) */
  margin: number;
  /** R:R (TP1) — riskten kar oranı */
  rr1: number;
  /** R:R (TP2) */
  rr2: number;
  /** Yüzdesel mesafeler (UI için) */
  stopPct: number;
  tp1Pct: number;
  tp2Pct: number;
  /** Feasibility */
  canAfford: boolean;
  /** OKX min boyut (10 USDT) */
  minSizeOK: boolean;
  /** Uyarı seviyesi */
  warnLevel: "ok" | "warning" | "blocked";
  /** Uyarı kind'ı (i18n için) */
  warnKind: "ok" | "insufficient_margin" | "below_min_size" | "locked";
  /** Uyarı metni (default TR) */
  warnMessage: string;
  /**
   * Emir modu — spread/fee bağlamı varsa dinamik, yoksa her zaman "market".
   */
  orderMode: "market" | "limit";
  /**
   * Fee-kalibre edilmiş TP fiyatları.
   * feeContext verilmezse orijinal TP fiyatlarıyla aynı.
   */
  feeAdjustedTp1: number;
  feeAdjustedTp2: number;
}

/**
 * Risk sabitleri — config-driven, ileride kullanıcı ayarlanabilir.
 */
export interface SizerConfig {
  BASE_RISK_TIERS: ReadonlyArray<{ maxBalance: number; risk: number }>;
  LEVERAGE_TIERS: ReadonlyArray<{ maxBalance: number; leverage: number }>;
  MIN_NOTIONAL_USD: number;
  STOP_BUFFER_ATR: number;
  STOP_TOO_CLOSE_ATR: number;
  STOP_TOO_FAR_ATR: number;
  ATR_FALLBACK_MULT: number;
  WIDENED_STOP_MULT: number;
  BUCKET_CUT_ADJ: number;
  BUCKET_BOOST_ADJ: number;
}

export const SIZER_CONFIG: SizerConfig = {
  /** Bakiye bazlı baz risk yüzdesi */
  BASE_RISK_TIERS: [
    { maxBalance: 200, risk: 0.005 }, // <$200: %0.5
    { maxBalance: 1000, risk: 0.01 }, // <$1000: %1
    { maxBalance: Infinity, risk: 0.015 }, // ≥$1000: %1.5
  ],
  /** Kaldıraç önerileri */
  LEVERAGE_TIERS: [
    { maxBalance: 50, leverage: 3 },
    { maxBalance: 200, leverage: 5 },
    { maxBalance: Infinity, leverage: 5 },
  ],
  /** OKX minimum notional (USDT) */
  MIN_NOTIONAL_USD: 10,
  /** Yapısal stop buffer (ATR çarpanı) */
  STOP_BUFFER_ATR: 0.3,
  /** Yapısal stop "çok yakın" eşiği (ATR çarpanı) */
  STOP_TOO_CLOSE_ATR: 0.8,
  /** Yapısal stop "çok uzak" eşiği (ATR çarpanı) */
  STOP_TOO_FAR_ATR: 2.5,
  /** ATR fallback mesafesi */
  ATR_FALLBACK_MULT: 1.5,
  /** Genişletilmiş stop mesafesi */
  WIDENED_STOP_MULT: 1.0,
  /** Bucket modifier — cut için */
  BUCKET_CUT_ADJ: 0.5,
  /** Bucket modifier — boost için */
  BUCKET_BOOST_ADJ: 1.25,
};
