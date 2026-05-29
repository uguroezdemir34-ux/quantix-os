/**
 * ESTIMATED LIQUIDATION MAP
 *
 * Hyblock Capital'in patent'lediği yaklaşımın bizim versiyonu.
 *
 * ═══════════ MANTIK ═══════════
 *
 * Borsalar trader pozisyonlarını vermez. Ama bize verir:
 *   - Mum bazlı fiyat geçmişi (OHLCV)
 *   - Open Interest (toplam pozisyon)
 *   - Funding rate (long/short ağırlığı)
 *
 * Bu üç sinyalden ISTATİSTİKSEL tahmin üretiriz:
 *   1. Son N mumda hacim ağırlıklı fiyatlar (VWAP-like accumulation zones)
 *   2. Tipik leverage tier (10x, 25x, 50x, 100x) için liq mesafeleri
 *   3. Yoğunluk haritası — yüksek likelihood zone'lar
 *
 * Bu, KESİN DEĞİL ama institutional flow yönünü doğru tahmin eder.
 * Magnet seviye = fiyat oraya gitme eğiliminde (cascade liquidation
 * tetikleyici).
 *
 * ═══════════ TICARI KULLANIM ═══════════
 *
 * - TP placement: yakın magnet seviyeye yakın koy
 * - SL placement: magnet seviyenin OTHER tarafına koy (sweep yenmesi için)
 * - Skoru güçlendirme: sinyal yönü magnet'e doğruysa +adjustment
 */

import type { Pair } from "@/lib/constants/pairs";
import type { Candle } from "./smc";

/**
 * Liquidation tahmin parametreleri.
 *
 * Leverage tier'lar (10x, 25x, 50x, 100x):
 *   - 10x: maintainence margin %1, liq mesafesi ~%9
 *   - 25x: maintenence margin %1, liq mesafesi ~%3.8
 *   - 50x: maintenence margin %0.5, liq mesafesi ~%1.9
 *   - 100x: maintenence margin %0.5, liq mesafesi ~%0.95
 *
 * Bu, OKX perpetual'larının tipik margin tier'larıdır.
 */
export interface LeverageTier {
  /** Leverage (örn. 50) */
  leverage: number;
  /** Maintenance margin oranı (0-1) */
  maintenanceMarginRate: number;
  /** Liq mesafesi (yaklaşık, %) */
  liqDistancePct: number;
  /** Bu tier'a verilen istatistiksel ağırlık (1 = orta, 2 = yüksek hacim) */
  weight: number;
}

export const DEFAULT_TIERS: LeverageTier[] = [
  // En çok kullanılan tier'lar — yüksek weight
  { leverage: 25, maintenanceMarginRate: 0.01, liqDistancePct: 0.038, weight: 2.5 },
  { leverage: 50, maintenanceMarginRate: 0.005, liqDistancePct: 0.019, weight: 3.0 },
  // Aşırı leverage (risk seven retail)
  { leverage: 100, maintenanceMarginRate: 0.005, liqDistancePct: 0.0095, weight: 1.5 },
  // Conservative
  { leverage: 10, maintenanceMarginRate: 0.01, liqDistancePct: 0.09, weight: 1.0 },
];

/**
 * Tek bir tahmini liquidation seviyesi.
 */
export interface LiquidationLevel {
  /** Tahmini liq fiyatı */
  price: number;
  /** Yön: long pozisyonlar buradan likide olur (price aşağıda) veya short */
  side: "long" | "short";
  /** Likelihood skoru (0-1, ne kadar çok pozisyon var) */
  intensity: number;
  /** Kaç leverage tier bu seviyeye katkı verdi */
  contributingTiers: number;
  /** Hangi fiyat aralığında accumulate olmuş (entry price tahmini) */
  estimatedEntryPrice: number;
  /** İnsan-okunaklı etiket */
  label: string;
}

export interface LiquidationMap {
  pair: Pair;
  /** Current spot price */
  currentPrice: number;
  /** Tüm tahmini liq seviyeleri */
  levels: LiquidationLevel[];
  /** En yakın long liq (currentPrice altında) */
  nearestLongLiq: LiquidationLevel | null;
  /** En yakın short liq (currentPrice üstünde) */
  nearestShortLiq: LiquidationLevel | null;
  /** Magnet zone'lar (yüksek intensity, currentPrice'a yakın) */
  magnetZones: LiquidationLevel[];
}

// ════════════════════ ACCUMULATION ZONE TESPİTİ ════════════════════

/**
 * Volume-weighted fiyat noktaları — hacim yoğunluk merkezleri.
 *
 * Trader'lar genelde hacim yoğun bölgelerde pozisyon açar (likidite var).
 * Bu noktalar "muhtemel entry" tahminleri.
 */
function findAccumulationPrices(
  candles: readonly Candle[],
  bucketCount: number = 20,
): { price: number; volume: number }[] {
  if (candles.length === 0) return [];

  const minPrice = Math.min(...candles.map((c) => c.low));
  const maxPrice = Math.max(...candles.map((c) => c.high));
  const bucketSize = (maxPrice - minPrice) / bucketCount;
  if (bucketSize === 0) return [];

  // Her bucket için toplam hacim
  const buckets = new Array<number>(bucketCount).fill(0);
  for (const c of candles) {
    // Mumun ortalama fiyatı
    const avgPrice = (c.high + c.low + c.close) / 3;
    const bucketIdx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((avgPrice - minPrice) / bucketSize)),
    );
    buckets[bucketIdx] += c.volume ?? 1;
  }

  // En yüksek hacimli 5 bucket'ı al
  const indexed = buckets
    .map((vol, i) => ({ vol, i }))
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 5);

  return indexed.map((b) => ({
    price: minPrice + (b.i + 0.5) * bucketSize,
    volume: b.vol,
  }));
}

// ════════════════════ LIQUIDATION HESAP ════════════════════

/**
 * Bir entry fiyatından ve leverage'dan liq fiyatı hesapla.
 *
 * Long liq: entry × (1 - liqDistancePct)
 * Short liq: entry × (1 + liqDistancePct)
 */
function calculateLiquidationPrice(
  entryPrice: number,
  side: "long" | "short",
  liqDistancePct: number,
): number {
  if (side === "long") {
    return entryPrice * (1 - liqDistancePct);
  }
  return entryPrice * (1 + liqDistancePct);
}

/**
 * Yakın liq seviyelerini cluster'la — aynı fiyat aralığındaki birkaç
 * tahmini tek "intensity zone" olarak birleştir.
 */
function clusterLevels(
  levels: LiquidationLevel[],
  proximityPct: number = 0.002,
): LiquidationLevel[] {
  if (levels.length === 0) return [];

  // Fiyata göre sırala
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const clusters: LiquidationLevel[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lvl = sorted[i];
    const last = clusters[clusters.length - 1];
    const lastAvgPrice =
      last.reduce((s, l) => s + l.price, 0) / last.length;
    // Aynı side + proximity altında → aynı cluster
    if (
      lvl.side === last[0].side &&
      Math.abs(lvl.price - lastAvgPrice) / lastAvgPrice < proximityPct
    ) {
      last.push(lvl);
    } else {
      clusters.push([lvl]);
    }
  }

  // Her cluster'ı tek seviyeye indirgе
  return clusters.map((cluster) => {
    const totalIntensity = cluster.reduce((s, l) => s + l.intensity, 0);
    const weightedPrice =
      cluster.reduce((s, l) => s + l.price * l.intensity, 0) /
      totalIntensity;
    return {
      price: weightedPrice,
      side: cluster[0].side,
      intensity: totalIntensity,
      contributingTiers: cluster.reduce(
        (s, l) => s + l.contributingTiers,
        0,
      ),
      estimatedEntryPrice: cluster[0].estimatedEntryPrice,
      label: `${cluster[0].side === "long" ? "Long" : "Short"} liq ${weightedPrice.toFixed(2)}`,
    };
  });
}

// ════════════════════ ANA FONKSİYON ════════════════════

export function buildLiquidationMap(
  pair: Pair,
  candles: readonly Candle[],
  currentPrice: number,
  tiers: LeverageTier[] = DEFAULT_TIERS,
): LiquidationMap {
  if (candles.length === 0 || currentPrice <= 0) {
    return {
      pair,
      currentPrice,
      levels: [],
      nearestLongLiq: null,
      nearestShortLiq: null,
      magnetZones: [],
    };
  }

  // 1. Accumulation zone'ları bul (muhtemel entry fiyatları)
  const accumulations = findAccumulationPrices(candles);

  // 2. Her accumulation × her tier × her side için liq tahmini
  const rawLevels: LiquidationLevel[] = [];
  for (const acc of accumulations) {
    for (const tier of tiers) {
      // Long pozisyonlar — liq aşağıda
      const longLiq = calculateLiquidationPrice(
        acc.price,
        "long",
        tier.liqDistancePct,
      );
      // Short pozisyonlar — liq yukarıda
      const shortLiq = calculateLiquidationPrice(
        acc.price,
        "short",
        tier.liqDistancePct,
      );

      // Intensity = hacim × tier ağırlığı
      const intensity = acc.volume * tier.weight;

      rawLevels.push({
        price: longLiq,
        side: "long",
        intensity,
        contributingTiers: 1,
        estimatedEntryPrice: acc.price,
        label: `Long liq ${longLiq.toFixed(2)}`,
      });
      rawLevels.push({
        price: shortLiq,
        side: "short",
        intensity,
        contributingTiers: 1,
        estimatedEntryPrice: acc.price,
        label: `Short liq ${shortLiq.toFixed(2)}`,
      });
    }
  }

  // 3. Cluster yakın seviyeler
  const clustered = clusterLevels(rawLevels);

  // 4. Intensity normalize et (0-1 aralığına)
  const maxIntensity = Math.max(...clustered.map((l) => l.intensity), 1);
  const normalized = clustered.map((l) => ({
    ...l,
    intensity: l.intensity / maxIntensity,
  }));

  // 5. En yakın long liq (currentPrice altında)
  const longLiqs = normalized
    .filter((l) => l.side === "long" && l.price < currentPrice)
    .sort((a, b) => b.price - a.price); // En yakın (en yüksek) önce
  const nearestLongLiq = longLiqs[0] ?? null;

  // 6. En yakın short liq (currentPrice üstünde)
  const shortLiqs = normalized
    .filter((l) => l.side === "short" && l.price > currentPrice)
    .sort((a, b) => a.price - b.price); // En yakın (en düşük) önce
  const nearestShortLiq = shortLiqs[0] ?? null;

  // 7. Magnet zone'lar: intensity > 0.5 ve currentPrice'a %3 mesafe içinde
  const magnetZones = normalized.filter(
    (l) =>
      l.intensity > 0.5 &&
      Math.abs(l.price - currentPrice) / currentPrice < 0.03,
  );

  return {
    pair,
    currentPrice,
    levels: normalized,
    nearestLongLiq,
    nearestShortLiq,
    magnetZones,
  };
}

// ════════════════════ SCORE INTEGRATION ════════════════════

/**
 * Liquidation map'in sinyal yönüne etkisi.
 *
 * Mantık:
 *   - LONG sinyal + yakında güçlü short liq (yukarıda) → +3 puan
 *     ("Magnet yukarıda, fiyat oraya çekilir")
 *   - LONG sinyal + yakında güçlü long liq (aşağıda) → -3 puan
 *     ("Magnet aşağıda, fiyat oraya düşebilir — RİSKLİ")
 *   - SHORT için tersi
 */
export function liquidationScoreAdjustment(
  map: LiquidationMap,
  signalDirection: "LONG" | "SHORT",
): { adjustment: number; reason: string } {
  if (!map.nearestLongLiq && !map.nearestShortLiq) {
    return { adjustment: 0, reason: "Liq map verisi yok" };
  }

  const longLiqDist = map.nearestLongLiq
    ? (map.currentPrice - map.nearestLongLiq.price) / map.currentPrice
    : 1;
  const shortLiqDist = map.nearestShortLiq
    ? (map.nearestShortLiq.price - map.currentPrice) / map.currentPrice
    : 1;

  // Yakın ve intensity yüksek mi?
  const longLiqStrong =
    longLiqDist < 0.02 && (map.nearestLongLiq?.intensity ?? 0) > 0.5;
  const shortLiqStrong =
    shortLiqDist < 0.02 && (map.nearestShortLiq?.intensity ?? 0) > 0.5;

  if (signalDirection === "LONG") {
    if (shortLiqStrong) {
      return {
        adjustment: 3,
        reason: `Short liq magnet ${(shortLiqDist * 100).toFixed(2)}% yukarıda — fiyat çekiliyor`,
      };
    }
    if (longLiqStrong) {
      return {
        adjustment: -3,
        reason: `Long liq magnet ${(longLiqDist * 100).toFixed(2)}% aşağıda — RİSKLİ`,
      };
    }
  } else {
    // SHORT
    if (longLiqStrong) {
      return {
        adjustment: 3,
        reason: `Long liq magnet ${(longLiqDist * 100).toFixed(2)}% aşağıda — fiyat çekiliyor`,
      };
    }
    if (shortLiqStrong) {
      return {
        adjustment: -3,
        reason: `Short liq magnet ${(shortLiqDist * 100).toFixed(2)}% yukarıda — RİSKLİ`,
      };
    }
  }

  return { adjustment: 0, reason: "Yakın magnet zone yok" };
}
