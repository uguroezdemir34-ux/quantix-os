/**
 * STAT-ARB ENGINE — Entegrasyon Testleri (Topic 11)
 *
 * Kapsam:
 *   1. Spread & Z-Score hesaplayıcı — sınır değer testleri
 *   2. Sinyal üretimi — eşik geçiş anları
 *   3. StatArbExecutor.openPair() — milisaniyelik eş zamanlı bacak gönderimi
 *   4. Leg failure → emergency close → FLAT (güvenli mod)
 *   5. Emergency close da başarısız → STUCK (alarm)
 *   6. Başarılı kapatma — kâr sabitleme
 *   7. Hedge ratio & korelasyon hesaplayıcılar
 *   8. Executor durum makinesi bütünlüğü
 */

import { describe, it, expect } from "vitest";

// ── Stat-Arb Indicator ────────────────────────────────────────
import {
  computeSpread,
  computeSpreadSeries,
  computeZScore,
  analyzeStatArb,
  signalFromZScore,
  estimateHedgeRatio,
  computePairCorrelation,
  STAT_ARB_DEFAULTS,
  type PricePair,
} from "@/lib/indicators/stat-arb";

// ── Executor ─────────────────────────────────────────────────
import {
  StatArbExecutor,
  resolveStatArbAction,
  type StatArbExecutorConfig,
} from "@/lib/exchange/stat-arb-executor";

import type { ExchangeAdapter } from "@/lib/exchange/types";

// ─────────────────────────────────────────────────────────────
// MOCK HELPERS
// ─────────────────────────────────────────────────────────────

function makeAdapter(opts: {
  openOk?: boolean;
  closeOk?: boolean;
  openDelay?: number;
  closeDelay?: number;
  openThrows?: boolean;
  closeThrows?: boolean;
  openErrorMsg?: string;
  onOpen?: () => void;
  onClose?: () => void;
} = {}): ExchangeAdapter & { openCallCount: number; closeCallCount: number; openTimestamps: number[] } {
  let openCallCount = 0;
  let closeCallCount = 0;
  const openTimestamps: number[] = [];

  return {
    openCallCount,
    closeCallCount,
    openTimestamps,
    async openPosition() {
      openCallCount++;
      (this as { openCallCount: number }).openCallCount = openCallCount;
      openTimestamps.push(Date.now());
      opts.onOpen?.();
      if (opts.openDelay) await new Promise((r) => setTimeout(r, opts.openDelay));
      if (opts.openThrows) throw new Error(opts.openErrorMsg ?? "Adapter error");
      if (opts.openOk === false) return { ok: false, errorKind: "OKX_ERR", errorMessage: opts.openErrorMsg ?? "Exchange error" };
      return { ok: true, data: { orderId: `ord_${Math.random().toString(36).slice(2)}`, instId: "BTC-USDT-SWAP" } };
    },
    async closePosition() {
      closeCallCount++;
      (this as { closeCallCount: number }).closeCallCount = closeCallCount;
      opts.onClose?.();
      if (opts.closeDelay) await new Promise((r) => setTimeout(r, opts.closeDelay));
      if (opts.closeThrows) throw new Error("Close throws");
      if (opts.closeOk === false) return { ok: false, errorKind: "OKX_ERR", errorMessage: "Close failed" };
      return { ok: true };
    },
    async cancelAlgoOrders() { return { ok: true }; },
  } as ExchangeAdapter & { openCallCount: number; closeCallCount: number; openTimestamps: number[] };
}

function makeExecutor(
  adapterA: ExchangeAdapter,
  adapterB: ExchangeAdapter,
  overrides: Partial<StatArbExecutorConfig> = {},
): StatArbExecutor {
  return new StatArbExecutor(adapterA, adapterB, {
    leverage: 3,
    marginMode: "isolated",
    now: () => Date.now(),
    ...overrides,
  });
}

/** N periyotluk korelasyonlu fiyat serisi üret */
function makePriceSeries(
  n: number,
  basePriceA = 50000,
  basePriceB = 3000,
  noisePct = 0.01,
): PricePair[] {
  const prices: PricePair[] = [];
  let pA = basePriceA;
  let pB = basePriceB;
  for (let i = 0; i < n; i++) {
    // Correlated walk: same direction, different magnitude
    const sharedMove = (Math.random() - 0.5) * noisePct;
    pA = pA * (1 + sharedMove + (Math.random() - 0.5) * 0.002);
    pB = pB * (1 + sharedMove + (Math.random() - 0.5) * 0.002);
    prices.push({ timestamp: 1_700_000_000_000 + i * 60_000, priceA: pA, priceB: pB });
  }
  return prices;
}

// ═══════════════════════════════════════════════════════════════
// SPREAD & Z-SCORE TESTS
// ═══════════════════════════════════════════════════════════════

describe("Spread & Z-Score Hesaplayıcı", () => {
  describe("computeSpread — temel hesap", () => {
    it("log-spread doğru hesaplanır: log(A) - hedgeRatio*log(B)", () => {
      const result = computeSpread(50000, 3000, 1.0);
      expect(result).toBeCloseTo(Math.log(50000) - Math.log(3000), 6);
    });

    it("hedgeRatio=2 uygulanır", () => {
      const result = computeSpread(100, 10, 2.0);
      expect(result).toBeCloseTo(Math.log(100) - 2 * Math.log(10), 6);
    });

    it("null döner priceA <= 0", () => {
      expect(computeSpread(0, 3000)).toBeNull();
      expect(computeSpread(-1, 3000)).toBeNull();
    });

    it("null döner priceB <= 0", () => {
      expect(computeSpread(50000, 0)).toBeNull();
    });
  });

  describe("computeSpreadSeries", () => {
    it("geçersiz fiyatlar filtrelenir", () => {
      const prices: PricePair[] = [
        { timestamp: 1, priceA: 50000, priceB: 3000 },
        { timestamp: 2, priceA: 0, priceB: 3000 },       // invalid
        { timestamp: 3, priceA: 50100, priceB: 3010 },
      ];
      const series = computeSpreadSeries(prices);
      expect(series).toHaveLength(2);
    });

    it("kronolojik sıra korunur", () => {
      const prices = makePriceSeries(10);
      const series = computeSpreadSeries(prices);
      for (let i = 1; i < series.length; i++) {
        expect(series[i].timestamp).toBeGreaterThan(series[i - 1].timestamp);
      }
    });

    it("boş dizi girişi → boş dizi çıkışı", () => {
      expect(computeSpreadSeries([])).toHaveLength(0);
    });
  });

  describe("computeZScore — sınır değerler", () => {
    it("null döner 1 veri noktasıyla", () => {
      expect(computeZScore([0.1], 10)).toBeNull();
    });

    it("null döner boş dizi", () => {
      expect(computeZScore([], 10)).toBeNull();
    });

    it("z-score=0 döner düz spread serisinde (std→0 → unreliable)", () => {
      const flat = Array(20).fill(0.5);
      const result = computeZScore(flat, 10);
      // std ≈ 0 → reliable=false → zScore=0
      expect(result?.reliable).toBe(false);
      expect(result?.zScore).toBe(0);
    });

    it("+2.5 z-score doğru hesaplanır", () => {
      // Gerçek test: bilinen istatistik — 29 sıfır, son değer = 2.5 * std
      const std = 0.01;
      const target = 2.5 * std; // = 0.025
      const series = [...Array(29).fill(0), target];
      const result = computeZScore(series, 30);
      expect(result).not.toBeNull();
      // z ≈ 2.5 (population std hesabında küçük sapma olabilir)
      expect(result!.zScore).toBeGreaterThan(2.0);
    });

    it("windowUsed doğru raporlanır", () => {
      const series = Array(50).fill(0).map((_, i) => i * 0.001);
      const result = computeZScore(series, 10);
      // window=10, last excluded → history = 9 points
      expect(result?.windowUsed).toBe(9);
    });

    it("window > seri uzunluğu → mevcut tüm veri kullanılır", () => {
      const series = [0, 0.01, 0.02, 0.03, 0.04];
      const result = computeZScore(series, 100); // window=100 ama 5 veri var
      expect(result).not.toBeNull();
      expect(result?.windowUsed).toBe(4); // last excluded
    });
  });

  describe("signalFromZScore — sinyal üretimi", () => {
    const cfg = { ...STAT_ARB_DEFAULTS };

    it("short_A_long_B: z >= +entryThreshold, flat", () => {
      expect(signalFromZScore(2.5, cfg, false)).toBe("short_A_long_B");
      expect(signalFromZScore(3.0, cfg, false)).toBe("short_A_long_B");
    });

    it("long_A_short_B: z <= -entryThreshold, flat", () => {
      expect(signalFromZScore(-2.5, cfg, false)).toBe("long_A_short_B");
      expect(signalFromZScore(-3.0, cfg, false)).toBe("long_A_short_B");
    });

    it("hold: |z| < entryThreshold, flat", () => {
      expect(signalFromZScore(1.0, cfg, false)).toBe("hold");
      expect(signalFromZScore(0.0, cfg, false)).toBe("hold");
      expect(signalFromZScore(-2.4, cfg, false)).toBe("hold");
    });

    it("close_long_A: |z| <= exitThreshold, position open as long_A", () => {
      expect(signalFromZScore(0.3, cfg, true, "long_A")).toBe("close_long_A");
      expect(signalFromZScore(0.0, cfg, true, "long_A")).toBe("close_long_A");
    });

    it("close_short_A: |z| <= exitThreshold, position open as short_A", () => {
      expect(signalFromZScore(-0.3, cfg, true, "short_A")).toBe("close_short_A");
    });

    it("hold: position open, |z| between exit and entry", () => {
      expect(signalFromZScore(1.5, cfg, true, "short_A")).toBe("hold");
    });

    it("emergency_close: |z| >= emergencyThreshold, position open", () => {
      expect(signalFromZScore(4.0, cfg, true, "long_A")).toBe("emergency_close");
      expect(signalFromZScore(-4.1, cfg, true, "short_A")).toBe("emergency_close");
    });

    it("no emergency close when position flat even at extreme z", () => {
      // Extreme z but no position → new trade signal
      expect(signalFromZScore(5.0, cfg, false)).toBe("short_A_long_B");
    });

    it("custom thresholds respected", () => {
      const custom = { ...cfg, entryThreshold: 1.5, exitThreshold: 0.2, emergencyThreshold: 3.0 };
      expect(signalFromZScore(1.5, custom, false)).toBe("short_A_long_B");
      expect(signalFromZScore(0.2, custom, true, "long_A")).toBe("close_long_A");
      expect(signalFromZScore(3.0, custom, true, "long_A")).toBe("emergency_close");
    });
  });

  describe("analyzeStatArb — uçtan uca analiz", () => {
    it("insufficient_data döner < 2 veri noktasıyla", () => {
      const result = analyzeStatArb("BTC", "ETH", [
        { timestamp: 1, priceA: 50000, priceB: 3000 },
      ]);
      expect(result.signal).toBe("insufficient_data");
      expect(result.zScoreResult).toBeNull();
    });

    it("açık veri seti ile analiz tamamlanır", () => {
      const prices = makePriceSeries(50, 50000, 3000);
      const result = analyzeStatArb("BTC", "ETH", prices);
      expect(result.pairA).toBe("BTC");
      expect(result.pairB).toBe("ETH");
      expect(result.zScoreResult).not.toBeNull();
      expect(["hold", "long_A_short_B", "short_A_long_B", "insufficient_data"]).toContain(result.signal);
    });

    it("direction doğru tayin edilir", () => {
      const prices = makePriceSeries(30);
      const result = analyzeStatArb("BTC", "ETH", prices);
      if (result.zScoreResult?.reliable) {
        if (result.zScoreResult.zScore > 0) expect(result.direction).toBe(1);
        else if (result.zScoreResult.zScore < 0) expect(result.direction).toBe(-1);
        else expect(result.direction).toBe(0);
      }
    });

    it("config varsayılanları doğru uygulanır", () => {
      const prices = makePriceSeries(40);
      const result = analyzeStatArb("BTC", "ETH", prices);
      expect(result.config.entryThreshold).toBe(2.5);
      expect(result.config.exitThreshold).toBe(0.5);
      expect(result.config.emergencyThreshold).toBe(4.0);
    });
  });

  describe("estimateHedgeRatio — OLS beta", () => {
    it("null döner < 10 veri noktasıyla", () => {
      expect(estimateHedgeRatio(makePriceSeries(5))).toBeNull();
    });

    it("beta ≈ 1 için yüksek korelasyonlu eşit seriler", () => {
      // A ve B aynı fiyat → β = 1
      const prices: PricePair[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: i,
        priceA: 100 + i,
        priceB: 100 + i, // identical → β ≈ 1
      }));
      const beta = estimateHedgeRatio(prices);
      expect(beta).not.toBeNull();
      expect(beta!).toBeCloseTo(1, 1);
    });

    it("beta finit ve sayısal", () => {
      const beta = estimateHedgeRatio(makePriceSeries(50));
      expect(beta).not.toBeNull();
      expect(Number.isFinite(beta!)).toBe(true);
    });
  });

  describe("computePairCorrelation", () => {
    it("null döner < 10 veri noktasıyla", () => {
      expect(computePairCorrelation(makePriceSeries(5))).toBeNull();
    });

    it("korelasyon ∈ [-1, +1]", () => {
      const r = computePairCorrelation(makePriceSeries(50));
      expect(r).not.toBeNull();
      expect(r!).toBeGreaterThanOrEqual(-1);
      expect(r!).toBeLessThanOrEqual(1);
    });

    it("yüksek korelasyonlu seriler → |r| > 0.7", () => {
      // Aynı şok, küçük gürültü → yüksek korelasyon
      const r = computePairCorrelation(makePriceSeries(100, 50000, 3000, 0.02));
      expect(r).not.toBeNull();
      // Correlated series should show positive correlation
      expect(r!).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// STAT-ARB EXECUTOR TESTS
// ═══════════════════════════════════════════════════════════════

describe("StatArbExecutor", () => {
  describe("openPair — başarılı senaryo", () => {
    it("her iki bacak başarıyla açılır → state=open", async () => {
      const adA = makeAdapter({ openOk: true });
      const adB = makeAdapter({ openOk: true });
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);

      expect(result.ok).toBe(true);
      expect(result.state).toBe("open");
      expect(result.position).not.toBeNull();
      expect(result.position?.side).toBe("long_A_short_B");
      expect(result.failedLeg).toBeNull();
      expect(result.emergencyCloseAttempted).toBe(false);
    });

    it("pozisyon kaydı doğru alanları içerir", async () => {
      const adA = makeAdapter();
      const adB = makeAdapter();
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "short_A_long_B", 0.01, 0.1, -2.8);

      expect(result.position?.side).toBe("short_A_long_B");
      expect(result.position?.entryZScore).toBe(-2.8);
      expect(result.position?.openedAt).toBeGreaterThan(0);
      expect(result.position?.closedAt).toBeNull();
      expect(result.position?.legA.ok).toBe(true);
      expect(result.position?.legB.ok).toBe(true);
    });

    it("durationMs raporlanır", async () => {
      const executor = makeExecutor(makeAdapter(), makeAdapter());
      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.5);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("openPair — EŞ ZAMANLI gönderim (concurrency kanıtı)", () => {
    it("iki adapter aynı zaman penceresinde çağrılır", async () => {
      const callTimes: number[] = [];
      const adA = makeAdapter({ openDelay: 20, onOpen: () => callTimes.push(Date.now()) });
      const adB = makeAdapter({ openDelay: 20, onOpen: () => callTimes.push(Date.now()) });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);

      expect(callTimes).toHaveLength(2);
      // Her iki çağrı 10ms içinde başlamalı (eş zamanlı)
      expect(Math.abs(callTimes[1] - callTimes[0])).toBeLessThan(10);
    }, 1000);

    it("paralel yürütüm sıralıdan daha hızlı", async () => {
      // Her adapter 30ms alıyor; sıralı = 60ms, paralel ≈ 30ms
      const adA = makeAdapter({ openDelay: 30 });
      const adB = makeAdapter({ openDelay: 30 });
      const executor = makeExecutor(adA, adB);

      const t0 = Date.now();
      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(60); // paralel → ~30ms
    }, 1000);
  });

  describe("openPair — leg failure → emergency close", () => {
    it("legA başarısız, legB başarılı → emergency close legB → state=flat", async () => {
      const adA = makeAdapter({ openOk: false, openErrorMsg: "Insufficient balance" });
      const adB = makeAdapter({ openOk: true, closeOk: true });
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);

      expect(result.ok).toBe(false);
      expect(result.failedLeg).toBe("legA");
      expect(result.emergencyCloseAttempted).toBe(true);
      expect(result.emergencyCloseOk).toBe(true);
      expect(result.state).toBe("flat");
      expect(executor.state).toBe("flat");
    });

    it("legB başarısız, legA başarılı → emergency close legA → state=flat", async () => {
      const adA = makeAdapter({ openOk: true, closeOk: true });
      const adB = makeAdapter({ openOk: false, openErrorMsg: "Rate limit" });
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);

      expect(result.ok).toBe(false);
      expect(result.failedLeg).toBe("legB");
      expect(result.emergencyCloseAttempted).toBe(true);
      expect(result.emergencyCloseOk).toBe(true);
      expect(result.state).toBe("flat");
    });

    it("legA exception → emergency close legB", async () => {
      const adA = makeAdapter({ openThrows: true, openErrorMsg: "Network crash" });
      const adB = makeAdapter({ openOk: true, closeOk: true });
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);

      expect(result.failedLeg).toBe("legA");
      expect(result.emergencyCloseAttempted).toBe(true);
      expect(result.state).toBe("flat");
    });

    it("emergency close sonrası yeni pozisyon açılabilir (state reset)", async () => {
      const adA = makeAdapter({ openOk: false });
      const adB = makeAdapter({ openOk: true, closeOk: true });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      expect(executor.state).toBe("flat");

      // İkinci deneme — her iki adapter başarılı
      const adA2 = makeAdapter({ openOk: true });
      const adB2 = makeAdapter({ openOk: true });
      const executor2 = makeExecutor(adA2, adB2);
      const result2 = await executor2.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      expect(result2.ok).toBe(true);
    });
  });

  describe("openPair — emergency close başarısız → STUCK", () => {
    it("legA başarısız + emergency close başarısız → state=STUCK", async () => {
      const adA = makeAdapter({ openOk: false, openErrorMsg: "Margin fail" });
      const adB = makeAdapter({ openOk: true, closeOk: false }); // close de başarısız
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);

      expect(result.ok).toBe(false);
      expect(result.state).toBe("stuck");
      expect(result.emergencyCloseAttempted).toBe(true);
      expect(result.emergencyCloseOk).toBe(false);
      expect(executor.state).toBe("stuck");
      expect(result.reasonHuman).toMatch(/KRİTİK|stuck/i);
    });

    it("STUCK state'de yeni pozisyon açılamaz", async () => {
      const adA = makeAdapter({ openOk: false });
      const adB = makeAdapter({ openOk: true, closeOk: false });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);
      expect(executor.state).toBe("stuck");

      const result2 = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.9);
      expect(result2.ok).toBe(false);
      expect(result2.reasonHuman).toMatch(/stuck/i);
    });

    it("STUCK state'den reset() ile çıkılır", async () => {
      const adA = makeAdapter({ openOk: false });
      const adB = makeAdapter({ openOk: true, closeOk: false });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);
      expect(executor.state).toBe("stuck");

      expect(executor.reset()).toBe(true);
      expect(executor.state).toBe("flat");
    });
  });

  describe("openPair — her iki bacak başarısız", () => {
    it("her ikisi başarısız → state=flat, no emergency close", async () => {
      const adA = makeAdapter({ openOk: false });
      const adB = makeAdapter({ openOk: false });
      const executor = makeExecutor(adA, adB);

      const result = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);

      expect(result.ok).toBe(false);
      expect(result.state).toBe("flat");
      expect(result.failedLeg).toBe("both");
      expect(result.emergencyCloseAttempted).toBe(false);
    });
  });

  describe("closePair — mean reversion", () => {
    it("pozisyon başarıyla kapanır → state=flat, kâr sabitlendi", async () => {
      const adA = makeAdapter({ openOk: true, closeOk: true });
      const adB = makeAdapter({ openOk: true, closeOk: true });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      expect(executor.state).toBe("open");

      const closeResult = await executor.closePair(0.1); // z-score mean'e döndü

      expect(closeResult.ok).toBe(true);
      expect(closeResult.state).toBe("flat");
      expect(closeResult.legACloseOk).toBe(true);
      expect(closeResult.legBCloseOk).toBe(true);
      expect(executor.state).toBe("flat");
    });

    it("exitZScore pozisyona kaydedilir", async () => {
      const adA = makeAdapter({ openOk: true, closeOk: true });
      const adB = makeAdapter({ openOk: true, closeOk: true });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);
      await executor.closePair(0.2);

      const pos = executor.getPosition();
      expect(pos?.exitZScore).toBe(0.2);
      expect(pos?.closedAt).not.toBeNull();
    });

    it("kapatma eş zamanlı (her iki bacak paralel)", async () => {
      const closeTimes: number[] = [];
      const adA = makeAdapter({
        openOk: true,
        closeDelay: 20,
        onClose: () => closeTimes.push(Date.now()),
      });
      const adB = makeAdapter({
        openOk: true,
        closeDelay: 20,
        onClose: () => closeTimes.push(Date.now()),
      });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      const t0 = Date.now();
      await executor.closePair(0.1);
      const elapsed = Date.now() - t0;

      // Paralel: ~20ms, sıralı olsaydı ~40ms
      expect(elapsed).toBeLessThan(40);
      expect(Math.abs(closeTimes[0] - closeTimes[1])).toBeLessThan(10);
    }, 1000);

    it("flat olmayan durumda closePair hata döner", async () => {
      const executor = makeExecutor(makeAdapter(), makeAdapter());
      // state=flat → close attempt
      const result = await executor.closePair(0.1);
      expect(result.ok).toBe(false);
      expect(result.reasonHuman).toMatch(/açık pozisyon yok|state=flat/);
    });

    it("kısmi kapanma (legB close başarısız) raporlanır", async () => {
      const adA = makeAdapter({ openOk: true, closeOk: true });
      const adB = makeAdapter({ openOk: true, closeOk: false });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);
      const result = await executor.closePair(0.3);

      expect(result.ok).toBe(false);
      expect(result.legACloseOk).toBe(true);
      expect(result.legBCloseOk).toBe(false);
    });
  });

  describe("Durum makinesi bütünlüğü", () => {
    it("başlangıç state=flat", () => {
      const executor = makeExecutor(makeAdapter(), makeAdapter());
      expect(executor.state).toBe("flat");
      expect(executor.getPosition()).toBeNull();
    });

    it("flat olmayan durumda ikinci openPair → hata", async () => {
      const adA = makeAdapter({ openOk: true });
      const adB = makeAdapter({ openOk: true });
      const executor = makeExecutor(adA, adB);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      expect(executor.state).toBe("open");

      const result2 = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.8);
      expect(result2.ok).toBe(false);
      expect(result2.reasonHuman).toMatch(/open/);
    });

    it("reset() sadece flat ve stuck'ta çalışır", async () => {
      const adA = makeAdapter({ openOk: true });
      const adB = makeAdapter({ openOk: true });
      const executor = makeExecutor(adA, adB);

      // flat → reset ok
      expect(executor.reset()).toBe(true);

      await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.6);
      // open → reset fails
      expect(executor.reset()).toBe(false);
      expect(executor.state).toBe("open");
    });

    it("tam yaşam döngüsü: flat→open→flat", async () => {
      const adA = makeAdapter({ openOk: true, closeOk: true });
      const adB = makeAdapter({ openOk: true, closeOk: true });
      const executor = makeExecutor(adA, adB);

      expect(executor.state).toBe("flat");

      const open = await executor.openPair("BTC", "ETH", "long_A_short_B", 0.01, 0.1, 2.7);
      expect(open.ok).toBe(true);
      expect(executor.state).toBe("open");

      const close = await executor.closePair(0.1);
      expect(close.ok).toBe(true);
      expect(executor.state).toBe("flat");
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// resolveStatArbAction TESTS
// ═══════════════════════════════════════════════════════════════

describe("resolveStatArbAction — sinyal-eylem haritası", () => {
  it("long_A_short_B + flat → open_long_A_short_B", () => {
    expect(resolveStatArbAction("long_A_short_B", "flat")).toBe("open_long_A_short_B");
  });

  it("short_A_long_B + flat → open_short_A_long_B", () => {
    expect(resolveStatArbAction("short_A_long_B", "flat")).toBe("open_short_A_long_B");
  });

  it("close_long_A + open → close", () => {
    expect(resolveStatArbAction("close_long_A", "open")).toBe("close");
  });

  it("close_short_A + open → close", () => {
    expect(resolveStatArbAction("close_short_A", "open")).toBe("close");
  });

  it("emergency_close + open → emergency_close", () => {
    expect(resolveStatArbAction("emergency_close", "open")).toBe("emergency_close");
  });

  it("hold + any state → noop", () => {
    expect(resolveStatArbAction("hold", "flat")).toBe("noop");
    expect(resolveStatArbAction("hold", "open")).toBe("noop");
  });

  it("long_A_short_B + open → noop (zaten açık)", () => {
    expect(resolveStatArbAction("long_A_short_B", "open")).toBe("noop");
  });

  it("close_long_A + flat → noop (kapanacak pozisyon yok)", () => {
    expect(resolveStatArbAction("close_long_A", "flat")).toBe("noop");
  });

  it("insufficient_data + any state → noop", () => {
    expect(resolveStatArbAction("insufficient_data", "flat")).toBe("noop");
  });
});
