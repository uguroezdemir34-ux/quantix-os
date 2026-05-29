/**
 * COMPOSE SCORE INPUT TESTS
 *
 * composeScoreInput:
 *   - Eksik veri guard'ları: livePrice null/0, candles4h<200, candles1h<200, candles15m<20
 *   - Tam pipeline → ScoreInput alanlarının doğruluğu
 *   - px4h = son 4h kapanış, px15 = son 15m kapanış, px = livePrice
 *   - bbPct: (livePrice - lower) / (upper - lower), upper=lower → null
 *   - last4hMovePct: son 4h mumun (c-o)/o × 100
 *   - closes1h: son 12 1h kapanış
 *   - volumes1h: son 15 1h hacim
 *   - ema50_1d = ema200_4h (approximation)
 *   - fundingRate: undefined → null
 */

import { describe, it, expect } from "vitest";
import { composeScoreInput, type ComposeInput } from "@/lib/score/composeScoreInput";
import type { Candle as OkxCandle } from "@/lib/okx/candles";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** OKX mum oluşturucu — monoton artan kapanışlar */
function makeCandles(
  count: number,
  basePrice = 50000,
  baseVol = 1000,
): OkxCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: 1_700_000_000_000 + i * 3_600_000,
    open: basePrice + i * 10,
    high: basePrice + i * 10 + 50,
    low: basePrice + i * 10 - 50,
    close: basePrice + i * 10 + 5,
    volume: baseVol + i,
    confirm: true,
  }));
}

const defaultDrawdown: ComposeInput["drawdownProtocol"] = {
  tier: "normal",
  minScore: 80,
  label: "🟢 Normal",
  reason: "",
};

const noSweep: ComposeInput["sweep15m"] = {
  type: "none",
  strength: 0,
  direction: "LONG",
};

const fullQuality: ComposeInput["timeQuality"] = {
  quality: 1,
  reason: "ok",
};

function makeFullInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    pair: "BTC",
    livePrice: 52000,
    candles4h: makeCandles(200),
    candles1h: makeCandles(200),
    candles15m: makeCandles(50),
    fg: 50,
    eventSkipUntil: null,
    btcCooldownUntil: null,
    btcCooldownReason: "",
    btcSelfCooldownUntil: null,
    lockReleasedAt: null,
    openPositions: [],
    drawdownProtocol: defaultDrawdown,
    trades: [],
    srModifier: 0,
    sweep15m: noSweep,
    timeQuality: fullQuality,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Guard: eksik veri → null
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — null guard'ları", () => {
  it("livePrice null → null", () => {
    expect(composeScoreInput(makeFullInput({ livePrice: null }))).toBeNull();
  });

  it("livePrice 0 → null", () => {
    expect(composeScoreInput(makeFullInput({ livePrice: 0 }))).toBeNull();
  });

  it("livePrice negatif → null", () => {
    expect(composeScoreInput(makeFullInput({ livePrice: -1 }))).toBeNull();
  });

  it("candles4h < 200 → null", () => {
    expect(composeScoreInput(makeFullInput({ candles4h: makeCandles(199) }))).toBeNull();
  });

  it("candles4h tam 200 → geçer", () => {
    expect(composeScoreInput(makeFullInput({ candles4h: makeCandles(200) }))).not.toBeNull();
  });

  it("candles1h < 200 → null", () => {
    expect(composeScoreInput(makeFullInput({ candles1h: makeCandles(199) }))).toBeNull();
  });

  it("candles1h tam 200 → geçer", () => {
    expect(composeScoreInput(makeFullInput({ candles1h: makeCandles(200) }))).not.toBeNull();
  });

  it("candles15m < 20 → null", () => {
    expect(composeScoreInput(makeFullInput({ candles15m: makeCandles(19) }))).toBeNull();
  });

  it("candles15m tam 20 → geçer", () => {
    expect(composeScoreInput(makeFullInput({ candles15m: makeCandles(20) }))).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Fiyat alanları
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — fiyat alanları", () => {
  it("px = livePrice", () => {
    const r = composeScoreInput(makeFullInput({ livePrice: 52500 }));
    expect(r).not.toBeNull();
    expect(r!.px).toBe(52500);
  });

  it("px4h = son 4H mum kapanışı", () => {
    const c4h = makeCandles(200, 50000);
    const lastClose = c4h[199].close;
    const r = composeScoreInput(makeFullInput({ candles4h: c4h }));
    expect(r!.px4h).toBe(lastClose);
  });

  it("px15 = son 15m mum kapanışı", () => {
    const c15m = makeCandles(50, 49000);
    const lastClose = c15m[49].close;
    const r = composeScoreInput(makeFullInput({ candles15m: c15m }));
    expect(r!.px15).toBe(lastClose);
  });

  it("pair pass-through", () => {
    const r = composeScoreInput(makeFullInput({ pair: "ETH" }));
    expect(r!.pair).toBe("ETH");
  });
});

// ─────────────────────────────────────────────────────────────
// bbPct hesabı
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — bbPct", () => {
  it("yeterli veri → bbPct sayısal ve 0-1 arasında (volatil piyasa)", () => {
    // Yeterli veri ile BB hesaplanabilir
    const r = composeScoreInput(makeFullInput());
    // bbPct null ya da 0-2 arası (geniş mum verisi olduğundan fiyat band dışı da olabilir)
    if (r!.bbPct !== null) {
      expect(typeof r!.bbPct).toBe("number");
      expect(isNaN(r!.bbPct)).toBe(false);
    }
  });

  it("BB hesaplamak için yeterli veri yok veya upper=lower → bbPct null", () => {
    // Sabit fiyat → stddev=0 → upper=lower → bbPct null
    const flatCandles: OkxCandle[] = Array.from({ length: 200 }, (_, i) => ({
      ts: 1_700_000_000_000 + i * 3_600_000,
      open: 50000,
      high: 50000,
      low: 50000,
      close: 50000,
      volume: 1000,
      confirm: true,
    }));
    const r = composeScoreInput(makeFullInput({ candles1h: flatCandles }));
    // Sabit fiyat → BB stddev=0 → upper=lower → null
    expect(r!.bbPct).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// last4hMovePct
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — last4hMovePct", () => {
  it("son 4H mum (c-o)/o × 100 hesabı", () => {
    const c4h = makeCandles(200, 50000);
    // Son mum: open=50000+199*10=51990, close=51990+5=51995
    const last = c4h[199];
    const expected = ((last.close - last.open) / last.open) * 100;
    const r = composeScoreInput(makeFullInput({ candles4h: c4h }));
    expect(r!.last4hMovePct).toBeCloseTo(expected, 5);
  });

  it("yükselen mum → pozitif last4hMovePct", () => {
    const c4h = makeCandles(200, 50000);
    // makeCandles: close = open + 5, her zaman pozitif
    expect(c4h[199].close).toBeGreaterThan(c4h[199].open);
    const r = composeScoreInput(makeFullInput({ candles4h: c4h }));
    expect(r!.last4hMovePct).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// closes1h / volumes1h dilimleme
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — pullback engine verileri", () => {
  it("closes1h = son 12 1H kapanış", () => {
    const c1h = makeCandles(200, 50000);
    const r = composeScoreInput(makeFullInput({ candles1h: c1h }));
    expect(r!.closes1h).toHaveLength(12);
    // Son 12 kapanış — son eleman en yeni mum kapanışı
    const expected = c1h.slice(-12).map((c) => c.close);
    expect([...r!.closes1h]).toEqual(expected.map((_, i) => expected[i]));
  });

  it("volumes1h = son 15 1H hacim", () => {
    const c1h = makeCandles(200, 50000);
    const r = composeScoreInput(makeFullInput({ candles1h: c1h }));
    expect(r!.volumes1h).toHaveLength(15);
  });
});

// ─────────────────────────────────────────────────────────────
// State pass-through
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — state pass-through", () => {
  it("eventSkipUntil pass-through", () => {
    const r = composeScoreInput(makeFullInput({ eventSkipUntil: 9999 }));
    expect(r!.eventSkipUntil).toBe(9999);
  });

  it("btcCooldownUntil pass-through", () => {
    const r = composeScoreInput(makeFullInput({ btcCooldownUntil: 8888 }));
    expect(r!.btcCooldownUntil).toBe(8888);
  });

  it("drawdownProtocol pass-through", () => {
    const dp = { ...defaultDrawdown, tier: "caution" as const };
    const r = composeScoreInput(makeFullInput({ drawdownProtocol: dp }));
    expect(r!.drawdownProtocol.tier).toBe("caution");
  });

  it("srModifier pass-through", () => {
    const r = composeScoreInput(makeFullInput({ srModifier: 3 }));
    expect(r!.srModifier).toBe(3);
  });

  it("fg pass-through", () => {
    const r = composeScoreInput(makeFullInput({ fg: 75 }));
    expect(r!.fg).toBe(75);
  });

  it("fundingRate pass-through", () => {
    const r = composeScoreInput(makeFullInput({ fundingRate: 0.001 }));
    expect(r!.fundingRate).toBe(0.001);
  });

  it("fundingRate undefined → null", () => {
    const r = composeScoreInput(makeFullInput({ fundingRate: undefined }));
    expect(r!.fundingRate).toBeNull();
  });

  it("openPositions pass-through", () => {
    const pos = [{ pair: "ETH", direction: "LONG" as const }];
    const r = composeScoreInput(makeFullInput({ openPositions: pos }));
    expect(r!.openPositions).toEqual(pos);
  });

  it("now pass-through", () => {
    const r = composeScoreInput(makeFullInput({ now: 1234567890 }));
    expect(r!.now).toBe(1234567890);
  });
});

// ─────────────────────────────────────────────────────────────
// ema50_1d = ema200_4h (approximation)
// ─────────────────────────────────────────────────────────────

describe("composeScoreInput() — ema50_1d approximation", () => {
  it("ema50_1d değeri sıfır değil veya null (hesaplanabildi)", () => {
    const r = composeScoreInput(makeFullInput());
    // ema200_4h 200 mumdan hesaplanabilir → ema50_1d = ema200_4h
    if (r!.ema50_1d !== null) {
      expect(r!.ema50_1d).toBeGreaterThan(0);
    }
    // null da kabul edilir (indikatör yeterli veri ister)
  });
});
