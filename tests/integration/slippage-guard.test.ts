/**
 * DYNAMIC SLIPPAGE GUARD — Kapsamlı Test Suite
 *
 * Doğrulanan davranışlar:
 *   1. Karar matrisi: risk skoru → ordType doğru seçiliyor
 *   2. ATR bileşeni: düşük/yüksek/extreme percentile → doğru skor
 *   3. Derinlik bileşeni: bol/yetersiz/sıfır likidite → doğru skor
 *   4. Limit fiyat hesabı: LONG=ask-offset, SHORT=bid+offset
 *   5. Fallback: OB yoksa market'a düşme
 *   6. Batch değerlendirme
 *   7. OKX params dönüştürme (toOkxOrderParams)
 *   8. Konfig override
 *   9. Sınır koşulları: null inputs, sıfır derinlik, %100 ATR
 *  10. Diagnostics alanları doğru doluyor
 */

import { describe, it, expect } from "vitest";
import {
  evaluateSlippageRisk,
  evaluateBatch,
  toOkxOrderParams,
  SLIPPAGE_GUARD_DEFAULTS,
} from "@/lib/exchange/slippage-guard";
import type { SlippageGuardInput } from "@/lib/exchange/slippage-guard";
import type { OrderBookSnapshot } from "@/lib/orderflow/orderbook";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeOrderBook(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
): OrderBookSnapshot {
  return {
    pair: "BTC",
    timestamp: Date.now(),
    bids: bids.map(([price, qty]) => ({ price, qty, notionalUsd: price * qty })),
    asks: asks.map(([price, qty]) => ({ price, qty, notionalUsd: price * qty })),
  };
}

/** Derin ve dengeli OB — yüksek likidite */
function deepOrderBook(): OrderBookSnapshot {
  return makeOrderBook(
    // 5 bid seviye, her biri 200K USD
    [[50000, 4], [49900, 4], [49800, 4], [49700, 4], [49600, 4]],
    [[50100, 4], [50200, 4], [50300, 4], [50400, 4], [50500, 4]],
  );
}

/** İnce OB — düşük likidite */
function thinOrderBook(): OrderBookSnapshot {
  return makeOrderBook(
    [[50000, 0.5], [49900, 0.5]],
    [[50100, 0.5], [50200, 0.5]],
  );
}

/** Sıfır likidite OB */
function emptyOrderBook(): OrderBookSnapshot {
  return makeOrderBook([], []);
}

function makeInput(
  overrides: Partial<SlippageGuardInput> = {},
): SlippageGuardInput {
  return {
    pair: "BTC",
    direction: "LONG",
    atrPercentile: 50,
    orderBook: deepOrderBook(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. Karar Matrisi
// ─────────────────────────────────────────────────────────────

describe("Karar matrisi — risk skoru → ordType", () => {
  it("düşük ATR + derin OB → MARKET emri seçilir", () => {
    const result = evaluateSlippageRisk(makeInput({
      atrPercentile: 20,
      orderBook: deepOrderBook(),
    }));
    expect(result.ordType).toBe("market");
    expect(result.limitPrice).toBeNull();
    expect(result.slippageRiskScore).toBeLessThan(SLIPPAGE_GUARD_DEFAULTS.RISK_LIMIT_THRESHOLD);
  });

  it("yüksek ATR + orta OB derinliği → LIMIT emri seçilir", () => {
    // ATR ~80 percentile + yarı dolu OB → orta risk
    const midOB = makeOrderBook(
      [[50000, 3], [49900, 3], [49800, 3]],
      [[50100, 3], [50200, 3], [50300, 3]],
    );
    const result = evaluateSlippageRisk(makeInput({
      atrPercentile: 82,
      orderBook: midOB,
    }));
    expect(result.ordType).toBe("limit");
    expect(result.slippageRiskScore).toBeGreaterThanOrEqual(
      SLIPPAGE_GUARD_DEFAULTS.RISK_LIMIT_THRESHOLD,
    );
    expect(result.slippageRiskScore).toBeLessThan(
      SLIPPAGE_GUARD_DEFAULTS.RISK_POSTONLY_THRESHOLD,
    );
  });

  it("extreme ATR + ince OB → POST_ONLY emri seçilir", () => {
    const result = evaluateSlippageRisk(makeInput({
      atrPercentile: 97,
      orderBook: thinOrderBook(),
    }));
    expect(result.ordType).toBe("post_only");
    expect(result.slippageRiskScore).toBeGreaterThanOrEqual(
      SLIPPAGE_GUARD_DEFAULTS.RISK_POSTONLY_THRESHOLD,
    );
  });

  it("risk skoru tam sınırda (RISK_LIMIT_THRESHOLD-1) → market", () => {
    // Config override ile kesin sınır testi
    const result = evaluateSlippageRisk(makeInput({
      config: {
        RISK_LIMIT_THRESHOLD: 40,
        RISK_POSTONLY_THRESHOLD: 70,
      },
      atrPercentile: 0,
      orderBook: deepOrderBook(),
    }));
    expect(result.ordType).toBe("market");
  });
});

// ─────────────────────────────────────────────────────────────
// 2. ATR Risk Bileşeni
// ─────────────────────────────────────────────────────────────

describe("ATR risk bileşeni", () => {
  const deepOB = deepOrderBook();

  it("ATR=0 → atrRiskScore=0", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: 0, orderBook: deepOB }));
    expect(r.atrRiskScore).toBe(0);
  });

  it("ATR=100 → atrRiskScore=60 (max)", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: 100, orderBook: deepOB }));
    expect(r.atrRiskScore).toBe(60);
  });

  it("ATR null → atrRiskScore=0 (bilinmeyen — tarafsız)", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: null, orderBook: deepOB }));
    expect(r.atrRiskScore).toBe(0);
  });

  it("HIGH_THRESHOLD altı → skor 30'dan küçük", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: SLIPPAGE_GUARD_DEFAULTS.ATR_HIGH_THRESHOLD - 1,
      orderBook: deepOB,
    }));
    expect(r.atrRiskScore).toBeLessThan(30);
  });

  it("EXTREME_THRESHOLD üzeri → skor 50'den büyük", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: SLIPPAGE_GUARD_DEFAULTS.ATR_EXTREME_THRESHOLD + 1,
      orderBook: deepOB,
    }));
    expect(r.atrRiskScore).toBeGreaterThan(50);
  });

  it("ATR monoton artar: pct50 < pct75 < pct90 < pct100", () => {
    const scores = [50, 75, 90, 100].map((pct) =>
      evaluateSlippageRisk(makeInput({ atrPercentile: pct, orderBook: deepOB })).atrRiskScore,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Derinlik Risk Bileşeni
// ─────────────────────────────────────────────────────────────

describe("Derinlik risk bileşeni", () => {
  it("bol likidite (≥ 2× eşik) → depthRiskScore=0", () => {
    // BTC eşik: 500K → 2× = 1M USD ask derinliği
    const richOB = makeOrderBook(
      [[50000, 10], [49900, 10]],
      [[50100, 10], [50200, 10], [50300, 10]], // her seviye 500K+ → toplamda yeterli
    );
    // 3 × (50100*10 + ...) > 1M
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 0,
      orderBook: richOB,
      pair: "BTC",
    }));
    expect(r.depthRiskScore).toBe(0);
  });

  it("sıfır derinlik → depthRiskScore=40 (max)", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 0,
      orderBook: emptyOrderBook(),
    }));
    expect(r.depthRiskScore).toBe(40);
  });

  it("OB null → depthRiskScore=0 (bilinmeyen — tarafsız)", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 0,
      orderBook: null,
    }));
    expect(r.depthRiskScore).toBe(0);
  });

  it("ETH için farklı eşik uygulanır (200K vs BTC 500K)", () => {
    // 300K ETH ask derinliği → ETH için yeterli (200K eşik × 2 = 400K → yarı dolu)
    // Aynı derinlik BTC için yetersiz (500K eşik)
    const ob = makeOrderBook(
      [[3200, 10]],
      [[3210, 30]], // 30 × 3210 ≈ 96K USD — ETH için az
    );

    const ethResult = evaluateSlippageRisk(makeInput({
      pair: "ETH",
      atrPercentile: 0,
      orderBook: ob,
    }));
    const btcResult = evaluateSlippageRisk(makeInput({
      pair: "BTC",
      atrPercentile: 0,
      orderBook: ob,
    }));

    // BTC için derinlik daha yetersiz → risk skoru daha yüksek
    expect(btcResult.depthRiskScore).toBeGreaterThan(ethResult.depthRiskScore);
  });

  it("SHORT için bid tarafı derinliği kullanılır", () => {
    // Bol bid, ince ask
    const ob = makeOrderBook(
      [[50000, 10], [49900, 10], [49800, 10], [49700, 10], [49600, 10]], // 2M USD bid
      [[50100, 0.1]], // Çok az ask
    );

    const longResult = evaluateSlippageRisk(makeInput({ direction: "LONG", orderBook: ob }));
    const shortResult = evaluateSlippageRisk(makeInput({ direction: "SHORT", orderBook: ob }));

    // LONG → ask derinliğine bakıyor → thin → yüksek risk
    // SHORT → bid derinliğine bakıyor → bol → düşük risk
    expect(shortResult.depthRiskScore).toBeLessThan(longResult.depthRiskScore);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Limit Fiyat Hesabı
// ─────────────────────────────────────────────────────────────

describe("Limit fiyat hesabı", () => {
  it("LONG limit = best_ask × (1 - LIMIT_OFFSET_PCT)", () => {
    const ob = makeOrderBook([], [[50100, 5]]);
    const r = evaluateSlippageRisk(makeInput({
      direction: "LONG",
      atrPercentile: 85,
      orderBook: ob,
    }));
    if (r.ordType !== "market") {
      const expected = parseFloat(
        (50100 * (1 - SLIPPAGE_GUARD_DEFAULTS.LIMIT_OFFSET_PCT)).toFixed(2),
      );
      expect(r.limitPrice).toBeCloseTo(expected, 2);
    }
  });

  it("SHORT limit = best_bid × (1 + LIMIT_OFFSET_PCT)", () => {
    const ob = makeOrderBook([[49900, 5]], []);
    const r = evaluateSlippageRisk(makeInput({
      direction: "SHORT",
      atrPercentile: 85,
      orderBook: ob,
    }));
    if (r.ordType !== "market") {
      const expected = parseFloat(
        (49900 * (1 + SLIPPAGE_GUARD_DEFAULTS.LIMIT_OFFSET_PCT)).toFixed(2),
      );
      expect(r.limitPrice).toBeCloseTo(expected, 2);
    }
  });

  it("MARKET ordType → limitPrice null", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: 10, orderBook: deepOrderBook() }));
    expect(r.ordType).toBe("market");
    expect(r.limitPrice).toBeNull();
  });

  it("OB fiyatı yoksa limit/post_only market fallback olur", () => {
    // ATR yüksek → post_only seçilmeli, ama OB fiyatı yok
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 97,
      orderBook: emptyOrderBook(), // fiyat yok
    }));
    // Fiyat alınamıyor → market fallback
    expect(r.ordType).toBe("market");
    expect(r.limitPrice).toBeNull();
    expect(r.reason).toContain("market fallback");
  });

  it("limitPrice 2 ondalık basamağa yuvarlanır", () => {
    const ob = makeOrderBook([], [[50100.123456789, 5]]);
    const r = evaluateSlippageRisk(makeInput({
      direction: "LONG",
      atrPercentile: 85,
      orderBook: ob,
    }));
    if (r.limitPrice !== null) {
      const decimalPlaces = (r.limitPrice.toString().split(".")[1] ?? "").length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 5. toOkxOrderParams()
// ─────────────────────────────────────────────────────────────

describe("toOkxOrderParams()", () => {
  it("market → ordType='market', px=undefined", () => {
    const params = toOkxOrderParams({
      ordType: "market",
      limitPrice: null,
      slippageRiskScore: 20,
      atrRiskScore: 10,
      depthRiskScore: 10,
      reason: "test",
      diagnostics: { atrPercentile: 20, depthNotionalUsd: 1000000, bestBid: null, bestAsk: null },
    });
    expect(params.ordType).toBe("market");
    expect(params.px).toBeUndefined();
  });

  it("limit → ordType='limit', px=limitPrice string", () => {
    const params = toOkxOrderParams({
      ordType: "limit",
      limitPrice: 50089.99,
      slippageRiskScore: 50,
      atrRiskScore: 30,
      depthRiskScore: 20,
      reason: "test",
      diagnostics: { atrPercentile: 80, depthNotionalUsd: 300000, bestBid: null, bestAsk: 50100 },
    });
    expect(params.ordType).toBe("limit");
    expect(params.px).toBe("50089.99");
  });

  it("post_only → ordType='post_only', px=limitPrice string", () => {
    const params = toOkxOrderParams({
      ordType: "post_only",
      limitPrice: 49999.5,
      slippageRiskScore: 80,
      atrRiskScore: 50,
      depthRiskScore: 30,
      reason: "test",
      diagnostics: { atrPercentile: 97, depthNotionalUsd: 50000, bestBid: 50000, bestAsk: null },
    });
    expect(params.ordType).toBe("post_only");
    expect(params.px).toBe("49999.5");
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Diagnostics
// ─────────────────────────────────────────────────────────────

describe("Diagnostics alanları", () => {
  it("atrPercentile diagnostics'te saklanır", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: 73 }));
    expect(r.diagnostics.atrPercentile).toBe(73);
  });

  it("null ATR diagnostics'te null gösterilir", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: null }));
    expect(r.diagnostics.atrPercentile).toBeNull();
  });

  it("bestBid/bestAsk OB'dan çekilir", () => {
    const ob = makeOrderBook([[49950, 1]], [[50050, 1]]);
    const r = evaluateSlippageRisk(makeInput({ orderBook: ob }));
    expect(r.diagnostics.bestBid).toBe(49950);
    expect(r.diagnostics.bestAsk).toBe(50050);
  });

  it("OB null → bestBid/bestAsk null", () => {
    const r = evaluateSlippageRisk(makeInput({ orderBook: null }));
    expect(r.diagnostics.bestBid).toBeNull();
    expect(r.diagnostics.bestAsk).toBeNull();
  });

  it("depthNotionalUsd hesaplanır", () => {
    // LONG → ask tarafı × qty
    const ob = makeOrderBook([], [[50100, 3], [50200, 2]]);
    const r = evaluateSlippageRisk(makeInput({ direction: "LONG", orderBook: ob }));
    // 50100*3 + 50200*2 = 150300 + 100400 = 250700
    expect(r.diagnostics.depthNotionalUsd).toBeCloseTo(250700, 0);
  });

  it("reason alanı boş değil", () => {
    const r = evaluateSlippageRisk(makeInput());
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Konfig Override
// ─────────────────────────────────────────────────────────────

describe("Konfig override", () => {
  it("RISK_LIMIT_THRESHOLD=100 → hiçbir zaman limit seçilmez", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 99,
      orderBook: thinOrderBook(),
      config: { RISK_LIMIT_THRESHOLD: 100, RISK_POSTONLY_THRESHOLD: 100 },
    }));
    expect(r.ordType).toBe("market");
  });

  it("RISK_LIMIT_THRESHOLD=0 → düşük risk bile limit seçer", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 5,
      orderBook: deepOrderBook(),
      config: { RISK_LIMIT_THRESHOLD: 0, RISK_POSTONLY_THRESHOLD: 100 },
    }));
    // Skor > 0 olduğu için limit seçilmeli
    expect(["limit", "post_only"]).toContain(r.ordType);
  });

  it("özel LIMIT_OFFSET_PCT limit fiyatını etkiler", () => {
    const ob = makeOrderBook([], [[50100, 5]]);

    const r1 = evaluateSlippageRisk(makeInput({
      atrPercentile: 85,
      orderBook: ob,
      config: { LIMIT_OFFSET_PCT: 0.0001 },
    }));
    const r2 = evaluateSlippageRisk(makeInput({
      atrPercentile: 85,
      orderBook: ob,
      config: { LIMIT_OFFSET_PCT: 0.001 },
    }));

    if (r1.limitPrice !== null && r2.limitPrice !== null) {
      // Daha büyük offset → daha düşük limit fiyat (LONG için)
      expect(r1.limitPrice).toBeGreaterThan(r2.limitPrice);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 8. evaluateBatch()
// ─────────────────────────────────────────────────────────────

describe("evaluateBatch()", () => {
  it("boş liste → boş çıktı", () => {
    expect(evaluateBatch([])).toHaveLength(0);
  });

  it("N input → N çıktı", () => {
    const inputs = [
      makeInput({ pair: "BTC", atrPercentile: 20 }),
      makeInput({ pair: "ETH", atrPercentile: 85 }),
      makeInput({ pair: "BTC", atrPercentile: 97 }),
    ];
    const results = evaluateBatch(inputs);
    expect(results).toHaveLength(3);
  });

  it("her input bağımsız değerlendirilir", () => {
    const inputs = [
      makeInput({ atrPercentile: 10 }),
      makeInput({ atrPercentile: 95, orderBook: thinOrderBook() }),
    ];
    const [low, high] = evaluateBatch(inputs);
    expect(low.slippageRiskScore).toBeLessThan(high.slippageRiskScore);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. Sınır Koşulları
// ─────────────────────────────────────────────────────────────

describe("Sınır koşulları", () => {
  it("ATR=0 + OB null → skor=0, market emri", () => {
    const r = evaluateSlippageRisk(makeInput({ atrPercentile: 0, orderBook: null }));
    expect(r.slippageRiskScore).toBe(0);
    expect(r.ordType).toBe("market");
  });

  it("ATR=100 + sıfır OB derinliği → skor=100 (max)", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 100,
      orderBook: emptyOrderBook(),
    }));
    expect(r.slippageRiskScore).toBe(100);
  });

  it("slippageRiskScore her zaman [0,100] aralığında", () => {
    const cases = [
      makeInput({ atrPercentile: 0, orderBook: null }),
      makeInput({ atrPercentile: 100, orderBook: emptyOrderBook() }),
      makeInput({ atrPercentile: 50, orderBook: deepOrderBook() }),
      makeInput({ atrPercentile: null, orderBook: null }),
    ];
    for (const input of cases) {
      const r = evaluateSlippageRisk(input);
      expect(r.slippageRiskScore).toBeGreaterThanOrEqual(0);
      expect(r.slippageRiskScore).toBeLessThanOrEqual(100);
    }
  });

  it("atrRiskScore + depthRiskScore ≤ 100 (overflow koruması)", () => {
    const r = evaluateSlippageRisk(makeInput({
      atrPercentile: 100,
      orderBook: emptyOrderBook(),
    }));
    expect(r.atrRiskScore + r.depthRiskScore).toBeLessThanOrEqual(100);
  });

  it("ETH pair desteklenir", () => {
    const result = evaluateSlippageRisk({
      pair: "ETH",
      direction: "SHORT",
      atrPercentile: 60,
      orderBook: makeOrderBook([[3200, 5]], [[3210, 5]]),
    });
    expect(result).toBeDefined();
    expect(result.ordType).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 10. Tam Senaryo Entegrasyonu
// ─────────────────────────────────────────────────────────────

describe("Tam senaryo entegrasyonu", () => {
  it("BTC flash crash senaryo: ATR=98 + ince OB → post_only + geçerli limit fiyat", () => {
    const ob = makeOrderBook(
      [[95000, 0.1]],
      [[95200, 0.1]],
    );
    const result = evaluateSlippageRisk({
      pair: "BTC",
      direction: "LONG",
      atrPercentile: 98,
      orderBook: ob,
    });
    expect(result.ordType).toBe("post_only");
    expect(result.limitPrice).not.toBeNull();
    expect(result.limitPrice!).toBeLessThan(95200); // ask'ın altı
    expect(result.limitPrice!).toBeGreaterThan(90000); // makul fiyat
  });

  it("BTC sakin piyasa: ATR=15 + derin OB → market + null limitPrice", () => {
    const result = evaluateSlippageRisk({
      pair: "BTC",
      direction: "LONG",
      atrPercentile: 15,
      orderBook: deepOrderBook(),
    });
    expect(result.ordType).toBe("market");
    expect(result.limitPrice).toBeNull();
  });

  it("OKX params entegrasyonu: post_only kararı adapter formatına dönüşür", () => {
    const ob = thinOrderBook();
    const result = evaluateSlippageRisk({
      pair: "BTC",
      direction: "LONG",
      atrPercentile: 95,
      orderBook: ob,
    });
    const okxParams = toOkxOrderParams(result);
    if (result.ordType === "post_only") {
      expect(okxParams.ordType).toBe("post_only");
      expect(typeof okxParams.px).toBe("string");
      expect(parseFloat(okxParams.px!)).toBeGreaterThan(0);
    }
  });

  it("ETH SHORT sakin piyasa → market emri", () => {
    const ob = makeOrderBook(
      [[3200, 100], [3195, 100], [3190, 100]],
      [[3205, 100], [3210, 100], [3215, 100]],
    );
    const result = evaluateSlippageRisk({
      pair: "ETH",
      direction: "SHORT",
      atrPercentile: 25,
      orderBook: ob,
    });
    expect(result.ordType).toBe("market");
  });
});
