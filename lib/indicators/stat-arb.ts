/**
 * STAT-ARB ENGINE — İstatistiksel Arbitraj: Spread & Z-Score Hesaplayıcı.
 *
 * Delta-nötr strateji temeli:
 *   İki yüksek korelasyonlu varlık arasındaki fiyat makası (Spread) tarihsel
 *   ortalamasından +2.5σ sapınca → pahalıya SHORT + ucuza LONG (pair trade).
 *   Z-Score → 0 döndüğünde iki bacak aynı anda kapanır, kâr sabitlenir.
 *
 * Spread formülü:
 *   spread_t = log(price_A_t) - hedgeRatio × log(price_B_t)
 *   Log spread tercih edilir çünkü daha durağan (stationary) ve ölçek-bağımsız.
 *
 * Hedge Ratio (β):
 *   İdeal: OLS regresyon ile hesaplanır. Bu modülde sabit veya dışarıdan
 *   inject edilir — çünkü kalibrasyon ayrı bir pipeline'a aittir.
 *
 * Z-Score:
 *   z = (spread_t - μ_window) / σ_window
 *   μ: Son N periyodun aritmetik ortalaması
 *   σ: Standart sapma (ddof=0 → population std)
 *
 * Sinyal eşikleri (ayarlanabilir):
 *   |z| > entryThreshold  → pozisyon aç (varsayılan 2.5)
 *   |z| < exitThreshold   → pozisyon kapat (varsayılan 0.5)
 *   |z| > emergencyThreshold → acil kapat (default 4.0) — trend sinyali
 *
 * Tüm fonksiyonlar saf (pure) — I/O yok.
 */

import type { Pair } from "@/lib/constants/pairs";

// ─── Tipler ──────────────────────────────────────────────────

/** Tek bir zaman dilimindeki iki varlık fiyatı */
export interface PricePair {
  /** Epoch ms */
  timestamp: number;
  priceA: number;
  priceB: number;
}

/** Hesaplanmış spread (log bazlı) */
export interface SpreadPoint {
  timestamp: number;
  spread: number;
  /** log(priceA) */
  logA: number;
  /** log(priceB) × hedgeRatio */
  logBScaled: number;
}

/** Z-Score hesaplama konfigürasyonu */
export interface StatArbConfig {
  /**
   * Rolling window boyutu (kaç periyot).
   * Ortalama ve std bu window üzerinden hesaplanır.
   * Default: 30
   */
  window?: number;
  /**
   * Hedge ratio (β) — B varlığının A'ya göre ağırlığı.
   * Default: 1.0 (eşit ağırlıklı log spread)
   */
  hedgeRatio?: number;
  /**
   * Pozisyon açma Z-Score eşiği.
   * Default: 2.5
   */
  entryThreshold?: number;
  /**
   * Pozisyon kapatma Z-Score eşiği (mean reversion).
   * Default: 0.5
   */
  exitThreshold?: number;
  /**
   * Acil kapatma eşiği — spread diverge ediyorsa (trend riski).
   * Default: 4.0
   */
  emergencyThreshold?: number;
}

/** Z-Score hesaplama sonucu */
export interface ZScoreResult {
  /** Güncel spread değeri */
  spread: number;
  /** Güncel z-score */
  zScore: number;
  /** Window ortalama spread */
  spreadMean: number;
  /** Window standart sapma */
  spreadStd: number;
  /** Hesaplamada kullanılan veri noktası sayısı */
  windowUsed: number;
  /** Sinyalin güvenilirliği: std çok küçükse düşük */
  reliable: boolean;
}

/** Stat-Arb sinyal kararı */
export type StatArbSignal =
  | "long_A_short_B"   // A ucuz, B pahalı → A'ya LONG, B'ye SHORT
  | "short_A_long_B"   // A pahalı, B ucuz → A'ya SHORT, B'ye LONG
  | "close_long_A"     // Mean reversion: A pozisyonu kapat
  | "close_short_A"    // Mean reversion: A pozisyonu kapat
  | "emergency_close"  // Eşik aşıldı, sistem güvenli moda
  | "hold"             // Sinyal yok, bekle
  | "insufficient_data"; // Yeterli veri yok

/** Tam stat-arb analiz sonucu */
export interface StatArbAnalysis {
  pairA: Pair;
  pairB: string; // spot vs vadeli veya farklı pair
  zScoreResult: ZScoreResult | null;
  signal: StatArbSignal;
  /**
   * Normalize edilmiş z-score'un yönü:
   * +1 → A değer kazanıyor (B'ye göre)
   * -1 → A değer kaybediyor
   */
  direction: 1 | -1 | 0;
  /** Konfigürasyon parametreleri (tanı için) */
  config: Required<StatArbConfig>;
}

// ─── Spread hesabı ────────────────────────────────────────────

/**
 * Log-spread serisi hesapla.
 * spread_t = log(priceA_t) - hedgeRatio × log(priceB_t)
 *
 * @param prices  Kronolojik sıralı fiyat çiftleri
 * @param hedgeRatio  Varsayılan 1.0
 */
export function computeSpreadSeries(
  prices: readonly PricePair[],
  hedgeRatio = 1.0,
): SpreadPoint[] {
  const result: SpreadPoint[] = [];
  for (const p of prices) {
    if (p.priceA <= 0 || p.priceB <= 0) continue;
    const logA = Math.log(p.priceA);
    const logBScaled = hedgeRatio * Math.log(p.priceB);
    result.push({
      timestamp: p.timestamp,
      logA,
      logBScaled,
      spread: logA - logBScaled,
    });
  }
  return result;
}

/**
 * Tek bir fiyat çifti için anlık spread (log-bazlı).
 * null → geçersiz fiyat.
 */
export function computeSpread(
  priceA: number,
  priceB: number,
  hedgeRatio = 1.0,
): number | null {
  if (priceA <= 0 || priceB <= 0) return null;
  return Math.log(priceA) - hedgeRatio * Math.log(priceB);
}

// ─── Rolling istatistikler ────────────────────────────────────

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stddev(values: readonly number[], avg: number): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (const v of values) sumSq += (v - avg) ** 2;
  return Math.sqrt(sumSq / values.length); // population std
}

// ─── Z-Score hesabı ──────────────────────────────────────────

/** Minimum std eşiği — bu altında hesaplama güvenilmez */
const MIN_STD = 1e-8;

/**
 * Z-Score hesapla: (spread_current - μ_window) / σ_window
 *
 * @param spreadHistory  Kronolojik spread serisi (en eski [0])
 * @param window         Kaç son değer kullanılacak
 * @returns null → yetersiz veri
 */
export function computeZScore(
  spreadHistory: readonly number[],
  window: number,
): ZScoreResult | null {
  if (spreadHistory.length < 2) return null;

  const slice = spreadHistory.slice(-Math.max(2, window));
  const currentSpread = slice[slice.length - 1];
  const historyForStats = slice.slice(0, -1); // current hariç — gerçek zamanlı leak yok

  if (historyForStats.length === 0) return null;

  const spreadMean = mean(historyForStats);
  const spreadStd = stddev(historyForStats, spreadMean);
  const reliable = spreadStd >= MIN_STD;
  const zScore = reliable ? (currentSpread - spreadMean) / spreadStd : 0;

  return {
    spread: parseFloat(currentSpread.toFixed(8)),
    zScore: parseFloat(zScore.toFixed(6)),
    spreadMean: parseFloat(spreadMean.toFixed(8)),
    spreadStd: parseFloat(spreadStd.toFixed(8)),
    windowUsed: historyForStats.length,
    reliable,
  };
}

// ─── Yapılandırma varsayılanları ──────────────────────────────

export const STAT_ARB_DEFAULTS: Required<StatArbConfig> = {
  window: 30,
  hedgeRatio: 1.0,
  entryThreshold: 2.5,
  exitThreshold: 0.5,
  emergencyThreshold: 4.0,
};

function resolveConfig(config: StatArbConfig = {}): Required<StatArbConfig> {
  return {
    window: config.window ?? STAT_ARB_DEFAULTS.window,
    hedgeRatio: config.hedgeRatio ?? STAT_ARB_DEFAULTS.hedgeRatio,
    entryThreshold: config.entryThreshold ?? STAT_ARB_DEFAULTS.entryThreshold,
    exitThreshold: config.exitThreshold ?? STAT_ARB_DEFAULTS.exitThreshold,
    emergencyThreshold: config.emergencyThreshold ?? STAT_ARB_DEFAULTS.emergencyThreshold,
  };
}

// ─── Sinyal üretimi ───────────────────────────────────────────

/**
 * Z-Score'dan stat-arb sinyali üret.
 *
 * @param zScore       Mevcut z-score
 * @param cfg          Yapılandırma
 * @param positionOpen Şu an açık pozisyon var mı?
 * @param openSide     Varsa hangi yönde açık? ('long_A'|'short_A')
 */
export function signalFromZScore(
  zScore: number,
  cfg: Required<StatArbConfig>,
  positionOpen = false,
  openSide?: "long_A" | "short_A",
): StatArbSignal {
  const absZ = Math.abs(zScore);

  // Acil kapatma — spread aşırı diverge etti
  if (positionOpen && absZ >= cfg.emergencyThreshold) {
    return "emergency_close";
  }

  // Pozisyon açıksa → mean reversion kontrolü
  if (positionOpen) {
    if (absZ <= cfg.exitThreshold) {
      return openSide === "long_A" ? "close_long_A" : "close_short_A";
    }
    return "hold";
  }

  // Pozisyon kapalı → yeni giriş kontrolü
  if (zScore >= cfg.entryThreshold) {
    // A pahalı B'ye göre → SHORT A, LONG B
    return "short_A_long_B";
  }
  if (zScore <= -cfg.entryThreshold) {
    // A ucuz B'ye göre → LONG A, SHORT B
    return "long_A_short_B";
  }

  return "hold";
}

// ─── Ana analiz fonksiyonu ────────────────────────────────────

/**
 * Tam stat-arb analizi: fiyat geçmişinden spread serisi → z-score → sinyal.
 *
 * @param pairA      Birinci varlık
 * @param pairB      İkinci varlık (spot/vadeli veya farklı coin)
 * @param prices     Kronolojik fiyat çiftleri (en eski [0])
 * @param config     Opsiyonel konfigürasyon
 * @param positionOpen  Şu an açık pozisyon var mı?
 * @param openSide   Hangi yönde açık
 */
export function analyzeStatArb(
  pairA: Pair,
  pairB: string,
  prices: readonly PricePair[],
  config: StatArbConfig = {},
  positionOpen = false,
  openSide?: "long_A" | "short_A",
): StatArbAnalysis {
  const cfg = resolveConfig(config);

  if (prices.length < 2) {
    return {
      pairA,
      pairB,
      zScoreResult: null,
      signal: "insufficient_data",
      direction: 0,
      config: cfg,
    };
  }

  const spreadSeries = computeSpreadSeries(prices, cfg.hedgeRatio);
  if (spreadSeries.length < 2) {
    return {
      pairA,
      pairB,
      zScoreResult: null,
      signal: "insufficient_data",
      direction: 0,
      config: cfg,
    };
  }

  const spreadHistory = spreadSeries.map((s) => s.spread);
  const zScoreResult = computeZScore(spreadHistory, cfg.window);

  if (!zScoreResult || !zScoreResult.reliable) {
    return {
      pairA,
      pairB,
      zScoreResult,
      signal: zScoreResult ? "hold" : "insufficient_data",
      direction: 0,
      config: cfg,
    };
  }

  const signal = signalFromZScore(zScoreResult.zScore, cfg, positionOpen, openSide);
  const direction: 1 | -1 | 0 =
    zScoreResult.zScore > 0 ? 1 : zScoreResult.zScore < 0 ? -1 : 0;

  return { pairA, pairB, zScoreResult, signal, direction, config: cfg };
}

// ─── Hedge ratio hesabı (OLS yaklaşımı) ──────────────────────

/**
 * Basitleştirilmiş hedge ratio tahmini:
 * β = Cov(logA, logB) / Var(logB)
 *
 * Gerçek OLS regresyon. İstatistiksel arbitraj için hedge ratio,
 * her N periyotta bir yeniden kalibrasyon yapılmalıdır.
 *
 * @param prices  Kalibrasyon için kullanılacak fiyat çiftleri
 * @returns null → yetersiz veri
 */
export function estimateHedgeRatio(prices: readonly PricePair[]): number | null {
  if (prices.length < 10) return null;

  const logAs: number[] = [];
  const logBs: number[] = [];

  for (const p of prices) {
    if (p.priceA <= 0 || p.priceB <= 0) continue;
    logAs.push(Math.log(p.priceA));
    logBs.push(Math.log(p.priceB));
  }

  if (logAs.length < 10) return null;

  const meanA = mean(logAs);
  const meanB = mean(logBs);

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < logAs.length; i++) {
    cov += (logAs[i] - meanA) * (logBs[i] - meanB);
    varB += (logBs[i] - meanB) ** 2;
  }

  if (varB < 1e-12) return null;
  const beta = cov / varB;
  return parseFloat(beta.toFixed(6));
}

// ─── Korelasyon hesabı ────────────────────────────────────────

/**
 * Pearson korelasyonu — iki varlığın log return'ları arasında.
 * Stat-arb çifti seçimi için kalite filtresi: |r| > 0.8 önerilebilir.
 *
 * @returns null → yetersiz veri
 */
export function computePairCorrelation(prices: readonly PricePair[]): number | null {
  if (prices.length < 10) return null;

  const logReturnsA: number[] = [];
  const logReturnsB: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev.priceA <= 0 || prev.priceB <= 0 || curr.priceA <= 0 || curr.priceB <= 0) continue;
    logReturnsA.push(Math.log(curr.priceA / prev.priceA));
    logReturnsB.push(Math.log(curr.priceB / prev.priceB));
  }

  if (logReturnsA.length < 5) return null;

  const meanA = mean(logReturnsA);
  const meanB = mean(logReturnsB);
  const stdA = stddev(logReturnsA, meanA);
  const stdB = stddev(logReturnsB, meanB);

  if (stdA < MIN_STD || stdB < MIN_STD) return null;

  let cov = 0;
  for (let i = 0; i < logReturnsA.length; i++) {
    cov += (logReturnsA[i] - meanA) * (logReturnsB[i] - meanB);
  }
  cov /= logReturnsA.length;

  return parseFloat((cov / (stdA * stdB)).toFixed(6));
}
