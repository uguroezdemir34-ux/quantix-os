/**
 * WS MESSAGES — OKX & Binance parser tests.
 *
 * parseOkxTicker, parseOkxTrades, parseBinanceTicker, parseAnyMessage
 */

import { describe, it, expect } from "vitest";
import {
  parseOkxTicker,
  parseOkxTrades,
  parseBinanceTicker,
  parseAnyMessage,
} from "@/lib/ws/messages";

const NOW = 1_700_000_000_000;

// ─────────────────────────────────────────────────────────────
// parseOkxTicker
// ─────────────────────────────────────────────────────────────

describe("parseOkxTicker()", () => {
  const validMsg = {
    arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
    data: [{ instId: "BTC-USDT-SWAP", last: "50000", open24h: "48000" }],
  };

  it("parses valid BTC ticker", () => {
    const tick = parseOkxTicker(validMsg, NOW);
    expect(tick).not.toBeNull();
    expect(tick!.pair).toBe("BTC");
    expect(tick!.last).toBe(50000);
    expect(tick!.open24h).toBe(48000);
    expect(tick!.source).toBe("ticker");
    expect(tick!.ts).toBe(NOW);
  });

  it("calculates chg correctly", () => {
    const tick = parseOkxTicker(validMsg, NOW);
    // (50000 - 48000) / 48000 * 100 ≈ 4.166...
    expect(tick!.chg).toBeCloseTo(4.1666, 3);
  });

  it("parses ETH-USDT-SWAP → pair ETH", () => {
    const msg = {
      arg: { channel: "tickers", instId: "ETH-USDT-SWAP" },
      data: [{ instId: "ETH-USDT-SWAP", last: "2000", open24h: "1900" }],
    };
    const tick = parseOkxTicker(msg, NOW);
    expect(tick!.pair).toBe("ETH");
  });

  it("missing open24h → chg = 0", () => {
    const msg = {
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", last: "50000" }],
    };
    const tick = parseOkxTicker(msg, NOW);
    expect(tick!.chg).toBe(0);
  });

  it("unknown instId (SOL) → null", () => {
    const msg = {
      arg: { channel: "tickers", instId: "SOL-USDT-SWAP" },
      data: [{ instId: "SOL-USDT-SWAP", last: "100" }],
    };
    expect(parseOkxTicker(msg, NOW)).toBeNull();
  });

  it("invalid price → null", () => {
    const msg = {
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", last: "NaN" }],
    };
    expect(parseOkxTicker(msg, NOW)).toBeNull();
  });

  it("zero price → null", () => {
    const msg = {
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", last: "0" }],
    };
    expect(parseOkxTicker(msg, NOW)).toBeNull();
  });

  it("wrong channel → null", () => {
    const msg = {
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", last: "50000" }],
    };
    expect(parseOkxTicker(msg, NOW)).toBeNull();
  });

  it("null input → null", () => {
    expect(parseOkxTicker(null, NOW)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// parseOkxTrades
// ─────────────────────────────────────────────────────────────

describe("parseOkxTrades()", () => {
  const validMsg = {
    arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
    data: [{ instId: "BTC-USDT-SWAP", px: "50000" }],
  };

  it("parses single BTC trade", () => {
    const ticks = parseOkxTrades(validMsg, NOW, { BTC: 48000 });
    expect(ticks).not.toBeNull();
    expect(ticks!).toHaveLength(1);
    expect(ticks![0].pair).toBe("BTC");
    expect(ticks![0].last).toBe(50000);
    expect(ticks![0].source).toBe("trade");
  });

  it("uses open24h from param for chg", () => {
    const ticks = parseOkxTrades(validMsg, NOW, { BTC: 48000 });
    expect(ticks![0].open24h).toBe(48000);
    expect(ticks![0].chg).toBeCloseTo(4.1666, 3);
  });

  it("no open24h in param → chg = 0", () => {
    const ticks = parseOkxTrades(validMsg, NOW, {});
    expect(ticks![0].chg).toBe(0);
  });

  it("multiple trades in batch", () => {
    const msg = {
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [
        { instId: "BTC-USDT-SWAP", px: "50000" },
        { instId: "BTC-USDT-SWAP", px: "50100" },
      ],
    };
    const ticks = parseOkxTrades(msg, NOW, {});
    expect(ticks!).toHaveLength(2);
    expect(ticks![1].last).toBe(50100);
  });

  it("unknown pair filtered from batch → null if all filtered", () => {
    const msg = {
      arg: { channel: "trades", instId: "SOL-USDT-SWAP" },
      data: [{ instId: "SOL-USDT-SWAP", px: "100" }],
    };
    expect(parseOkxTrades(msg, NOW, {})).toBeNull();
  });

  it("invalid px filtered → null if all invalid", () => {
    const msg = {
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", px: "bad" }],
    };
    expect(parseOkxTrades(msg, NOW, {})).toBeNull();
  });

  it("wrong channel → null", () => {
    const msg = {
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", px: "50000" }],
    };
    expect(parseOkxTrades(msg, NOW, {})).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// parseBinanceTicker
// ─────────────────────────────────────────────────────────────

describe("parseBinanceTicker()", () => {
  const validMsg = {
    stream: "btcusdt@ticker",
    data: { s: "BTCUSDT", c: "50000", o: "48000" },
  };

  it("parses valid BTC ticker", () => {
    const tick = parseBinanceTicker(validMsg, NOW);
    expect(tick).not.toBeNull();
    expect(tick!.pair).toBe("BTC");
    expect(tick!.last).toBe(50000);
    expect(tick!.open24h).toBe(48000);
    expect(tick!.source).toBe("ticker");
  });

  it("parses ETH ticker", () => {
    const msg = {
      stream: "ethusdt@ticker",
      data: { s: "ETHUSDT", c: "2000", o: "1900" },
    };
    expect(parseBinanceTicker(msg, NOW)!.pair).toBe("ETH");
  });

  it("unknown symbol → null", () => {
    const msg = {
      stream: "solusdt@ticker",
      data: { s: "SOLUSDT", c: "100" },
    };
    expect(parseBinanceTicker(msg, NOW)).toBeNull();
  });

  it("invalid close price → null", () => {
    const msg = {
      stream: "btcusdt@ticker",
      data: { s: "BTCUSDT", c: "NaN" },
    };
    expect(parseBinanceTicker(msg, NOW)).toBeNull();
  });

  it("missing open → chg = 0", () => {
    const msg = {
      stream: "btcusdt@ticker",
      data: { s: "BTCUSDT", c: "50000" },
    };
    const tick = parseBinanceTicker(msg, NOW);
    expect(tick!.chg).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// parseAnyMessage
// ─────────────────────────────────────────────────────────────

describe("parseAnyMessage()", () => {
  it("routes OKX ticker correctly", () => {
    const msg = {
      arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", last: "50000", open24h: "48000" }],
    };
    const ticks = parseAnyMessage(msg, NOW, {});
    expect(ticks).not.toBeNull();
    expect(ticks!).toHaveLength(1);
    expect(ticks![0].source).toBe("ticker");
  });

  it("routes OKX trades correctly", () => {
    const msg = {
      arg: { channel: "trades", instId: "BTC-USDT-SWAP" },
      data: [{ instId: "BTC-USDT-SWAP", px: "50000" }],
    };
    const ticks = parseAnyMessage(msg, NOW, {});
    expect(ticks).not.toBeNull();
    expect(ticks![0].source).toBe("trade");
  });

  it("routes Binance ticker correctly", () => {
    const msg = {
      stream: "btcusdt@ticker",
      data: { s: "BTCUSDT", c: "50000", o: "48000" },
    };
    const ticks = parseAnyMessage(msg, NOW, {});
    expect(ticks).not.toBeNull();
    expect(ticks!).toHaveLength(1);
    expect(ticks![0].pair).toBe("BTC");
  });

  it("unknown message shape → null", () => {
    expect(parseAnyMessage({ foo: "bar" }, NOW, {})).toBeNull();
    expect(parseAnyMessage(null, NOW, {})).toBeNull();
    expect(parseAnyMessage("string", NOW, {})).toBeNull();
  });

  it("OKX unknown channel → null", () => {
    const msg = {
      arg: { channel: "candles", instId: "BTC-USDT-SWAP" },
      data: [{}],
    };
    expect(parseAnyMessage(msg, NOW, {})).toBeNull();
  });
});
