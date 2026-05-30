/**
 * WHALE INFLOW PARSER — Büyük Fon Akışı Sinyali.
 *
 * Borsalara giren/çıkan büyük stabilcoin + BTC hacimlerini ayrıştırır.
 * On-chain Exchange Inflow/Outflow verisi simüle edilmiş veya dış API'den
 * (Glassnode, CryptoQuant, vb.) beslenerek skor motoruna katkı sağlar.
 *
 * Teorik temel:
 *   - Exchange Inflow ↑ (BTC borsaya giriyor) → satış baskısı potansiyeli → bearish
 *   - Exchange Outflow ↑ (BTC borsadan çıkıyor) → HODLing artıyor → bullish
 *   - Stablecoin Inflow ↑ (USDT/USDC borsaya giriyor) → alım gücü birikimi → bullish
 *   - Stablecoin Outflow ↑ (stablecoin çıkıyor) → nakit çekiliyor → bearish
 *
 * whaleInflowScore ∈ [-10, +10]:
 *   Pozitif: net bullish whale basıncı (stablecoin inflow veya BTC outflow)
 *   Negatif: net bearish whale basıncı (BTC inflow veya stablecoin outflow)
 *
 * Tüm fonksiyonlar saf (pure) — I/O yok.
 */

// ─── Tipler ──────────────────────────────────────────────────

/** Tek bir whale akış veri noktası */
export interface WhaleFlowSnapshot {
  /** Epoch ms */
  timestamp: number;
  /**
   * BTC exchange inflow (24h, coin cinsinden).
   * Pozitif = borsaya giriyor (satış baskısı potansiyeli).
   */
  btcExchangeInflow: number;
  /**
   * BTC exchange outflow (24h, coin cinsinden).
   * Pozitif = borsadan çıkıyor (HODL artıyor).
   */
  btcExchangeOutflow: number;
  /**
   * Stablecoin exchange inflow (USDT+USDC, USD cinsinden, milyar değil — raw USDT).
   * Pozitif = borsaya alım gücü giriyor.
   */
  stablecoinInflow: number;
  /**
   * Stablecoin exchange outflow (USD cinsinden).
   * Pozitif = alım gücü borsadan çıkıyor.
   */
  stablecoinOutflow: number;
}

/** Whale akış yönü */
export type WhaleFlowBias =
  | "strong_bullish"   // Net stablecoin inflow + BTC outflow baskın
  | "mild_bullish"     // Zayıf net alım gücü birikimi
  | "neutral"          // Dengeli ya da eşik altı
  | "mild_bearish"     // Zayıf net satış baskısı
  | "strong_bearish";  // Net BTC inflow + stablecoin outflow baskın

/** Whale akış analiz sonucu */
export interface WhaleFlowResult {
  /**
   * Net BTC akışı (outflow - inflow).
   * Pozitif: net outflow (bullish) — Negatif: net inflow (bearish)
   */
  netBtcFlowNorm: number;
  /**
   * Net stablecoin akışı (inflow - outflow), normalize.
   * Pozitif: net inflow (bullish) — Negatif: net outflow (bearish)
   */
  netStableFlowNorm: number;
  /** Tespit edilen whale yön eğilimi */
  bias: WhaleFlowBias;
  /**
   * Skor motoru için normalize edilmiş sinyal: [-10, +10].
   * +10: çok güçlü bullish whale sinyali
   * -10: çok güçlü bearish whale sinyali
   */
  whaleInflowScore: number;
  /** Analiz edilen snapshot sayısı */
  snapshotCount: number;
}

export interface WhaleFlowConfig {
  /**
   * BTC net flow normalizasyon referansı (coin).
   * Bu değer ve üstü "extreme" kabul edilir.
   * Default: 5000 BTC/gün (tipik whale eşiği)
   */
  btcNormRef?: number;
  /**
   * Stablecoin net flow normalizasyon referansı (USD).
   * Default: 500_000_000 ($500M/gün)
   */
  stableNormRef?: number;
  /**
   * Skor büyüteç — rawScore = combinedSignal × scoreFactor, clamp [-10, +10].
   * Default: 10
   */
  scoreFactor?: number;
  /**
   * Eşik altı sinyal → nötr (noise filtresi).
   * Default: 0.05 (normalize değerin %5'i)
   */
  noiseThreshold?: number;
}

// ─── Normalizasyon ───────────────────────────────────────────

/**
 * Net flow'u [-1, +1] aralığına normalize et (tanh benzeri lineer clamp).
 * abs(netFlow) >= normRef → ±1
 */
function normalizeFlow(netFlow: number, normRef: number): number {
  if (normRef <= 0) return 0;
  return Math.max(-1, Math.min(1, netFlow / normRef));
}

// ─── Bias sınıflandırması ────────────────────────────────────

function classifyBias(combinedSignal: number, noiseThreshold: number): WhaleFlowBias {
  const abs = Math.abs(combinedSignal);
  if (abs < noiseThreshold) return "neutral";
  if (combinedSignal >= 0.5) return "strong_bullish";
  if (combinedSignal >= noiseThreshold) return "mild_bullish";
  if (combinedSignal <= -0.5) return "strong_bearish";
  return "mild_bearish";
}

// ─── Ana hesap fonksiyonu ─────────────────────────────────────

/**
 * Whale akış skorunu hesapla.
 *
 * Birden fazla snapshot varsa ortalama net flow kullanılır.
 *
 * @param snapshots   Kronolojik sıralı whale akış noktaları (en eski [0])
 * @param config      Opsiyonel konfigürasyon
 * @returns null → yetersiz/geçersiz veri (en az 1 snapshot gerekli)
 */
export function computeWhaleFlow(
  snapshots: readonly WhaleFlowSnapshot[],
  config: WhaleFlowConfig = {},
): WhaleFlowResult | null {
  if (!snapshots || snapshots.length === 0) return null;

  const btcNormRef = config.btcNormRef ?? 5000;
  const stableNormRef = config.stableNormRef ?? 500_000_000;
  const scoreFactor = config.scoreFactor ?? 10;
  const noiseThreshold = config.noiseThreshold ?? 0.05;

  // Geçersiz snapshot filtrele (negatif değerler geçersiz)
  const valid = snapshots.filter(
    (s) =>
      s.btcExchangeInflow >= 0 &&
      s.btcExchangeOutflow >= 0 &&
      s.stablecoinInflow >= 0 &&
      s.stablecoinOutflow >= 0,
  );
  if (valid.length === 0) return null;

  // Ortalama değerler üzerinden net flow
  let sumBtcNet = 0;
  let sumStableNet = 0;
  for (const s of valid) {
    // BTC net: outflow - inflow (pozitif = bullish)
    sumBtcNet += s.btcExchangeOutflow - s.btcExchangeInflow;
    // Stablecoin net: inflow - outflow (pozitif = bullish)
    sumStableNet += s.stablecoinInflow - s.stablecoinOutflow;
  }
  const avgBtcNet = sumBtcNet / valid.length;
  const avgStableNet = sumStableNet / valid.length;

  const netBtcFlowNorm = normalizeFlow(avgBtcNet, btcNormRef);
  const netStableFlowNorm = normalizeFlow(avgStableNet, stableNormRef);

  // Kombine sinyal: BTC %40, Stablecoin %60 ağırlık
  const combinedSignal = netBtcFlowNorm * 0.4 + netStableFlowNorm * 0.6;

  const bias = classifyBias(combinedSignal, noiseThreshold);

  const rawScore = combinedSignal * scoreFactor;
  const whaleInflowScore = Math.max(-10, Math.min(10, parseFloat(rawScore.toFixed(4))));

  return {
    netBtcFlowNorm: parseFloat(netBtcFlowNorm.toFixed(6)),
    netStableFlowNorm: parseFloat(netStableFlowNorm.toFixed(6)),
    bias,
    whaleInflowScore,
    snapshotCount: valid.length,
  };
}

/**
 * Kayan pencere: son N snapshot üzerinden whale akış hesabı.
 * @param windowSize  Son kaç snapshot kullanılacak (default 3)
 */
export function computeWhaleFlowWindow(
  snapshots: readonly WhaleFlowSnapshot[],
  windowSize = 3,
  config: WhaleFlowConfig = {},
): WhaleFlowResult | null {
  if (snapshots.length === 0) return null;
  const window = snapshots.slice(-Math.max(1, windowSize));
  return computeWhaleFlow(window, config);
}

/**
 * Normalize edilmiş whale skor [-10, +10] → skor motoruna eklenecek katkı.
 * null → 0 (tarafsız).
 */
export function whaleInflowScoreOrZero(result: WhaleFlowResult | null): number {
  return result?.whaleInflowScore ?? 0;
}
