/**
 * MACRO REGIME TESTS
 *
 * getFgInfo: 5 eşik (fear/caution/neutral/greed/extreme-greed), clamp, round
 * getDominancePhase: no_data, risk_off_usdt, btc_trend, altcoin_season, mixed
 * getMarketSummary: 5 durum (risk_on_caution, risk_off, risk_on_healthy, neutral, undecided)
 */

import { describe, it, expect } from "vitest";
import { getFgInfo, getDominancePhase, getMarketSummary } from "@/lib/macro/regime";
import { MACRO_CONSTANTS } from "@/lib/macro/types";

// ─────────────────────────────────────────────────────────────
// getFgInfo
// ─────────────────────────────────────────────────────────────

describe("getFgInfo()", () => {
  it("< 25 → AŞIRI KORKU / fear", () => {
    const r = getFgInfo(10);
    expect(r.label).toBe("AŞIRI KORKU");
    expect(r.cssClass).toBe("fear");
    expect(r.value).toBe(10);
  });

  it("25-44 → KORKU / caution", () => {
    const r = getFgInfo(35);
    expect(r.label).toBe("KORKU");
    expect(r.cssClass).toBe("caution");
  });

  it("45-54 → NÖTR / neutral", () => {
    const r = getFgInfo(50);
    expect(r.label).toBe("NÖTR");
    expect(r.cssClass).toBe("neutral");
  });

  it("55-74 → AÇGÖZLÜ / greed", () => {
    const r = getFgInfo(60);
    expect(r.label).toBe("AÇGÖZLÜ");
    expect(r.cssClass).toBe("greed");
  });

  it("≥ 75 → AŞIRI AÇGÖZLÜ / extreme-greed", () => {
    const r = getFgInfo(80);
    expect(r.label).toBe("AŞIRI AÇGÖZLÜ");
    expect(r.cssClass).toBe("extreme-greed");
    expect(r.value).toBe(80);
  });

  it("boundary: exactly 25 → KORKU (not fear)", () => {
    expect(getFgInfo(25).cssClass).toBe("caution");
  });

  it("boundary: exactly 45 → NÖTR", () => {
    expect(getFgInfo(45).cssClass).toBe("neutral");
  });

  it("boundary: exactly 55 → AÇGÖZLÜ", () => {
    expect(getFgInfo(55).cssClass).toBe("greed");
  });

  it("boundary: exactly 75 → AŞIRI AÇGÖZLÜ", () => {
    expect(getFgInfo(75).cssClass).toBe("extreme-greed");
  });

  it("clamp: value > 100 → capped at 100", () => {
    const r = getFgInfo(150);
    expect(r.value).toBe(100);
    expect(r.cssClass).toBe("extreme-greed");
  });

  it("clamp: negative → 0 → AŞIRI KORKU", () => {
    const r = getFgInfo(-5);
    expect(r.value).toBe(0);
    expect(r.cssClass).toBe("fear");
  });

  it("rounding: 24.6 rounds to 25 → caution", () => {
    expect(getFgInfo(24.6).cssClass).toBe("caution");
  });

  it("rounding: 24.4 rounds to 24 → fear", () => {
    expect(getFgInfo(24.4).cssClass).toBe("fear");
  });
});

// ─────────────────────────────────────────────────────────────
// getDominancePhase
// ─────────────────────────────────────────────────────────────

describe("getDominancePhase()", () => {
  it("btcD=0 → no_data", () => {
    const r = getDominancePhase(0, 3.0);
    expect(r.phase).toBe("no_data");
  });

  it("usdtD=0 → no_data", () => {
    const r = getDominancePhase(55, 0);
    expect(r.phase).toBe("no_data");
  });

  it("usdtD ≥ 5.5 → risk_off_usdt", () => {
    const r = getDominancePhase(50, 5.5);
    expect(r.phase).toBe("risk_off_usdt");
  });

  it("usdtD > 5.5 → risk_off_usdt", () => {
    const r = getDominancePhase(55, 6.0);
    expect(r.phase).toBe("risk_off_usdt");
  });

  it("btcD ≥ 55, usdtD < 5.0 → btc_trend", () => {
    const r = getDominancePhase(57, 4.5);
    expect(r.phase).toBe("btc_trend");
  });

  it("btcD < 50, usdtD < 5.0 → altcoin_season", () => {
    const r = getDominancePhase(45, 4.0);
    expect(r.phase).toBe("altcoin_season");
  });

  it("btcD 50-54, usdtD < 5.0 → mixed", () => {
    const r = getDominancePhase(52, 4.5);
    expect(r.phase).toBe("mixed");
  });

  it("result includes btcD and usdtD values", () => {
    const r = getDominancePhase(57, 4.5);
    expect(r.btcD).toBe(57);
    expect(r.usdtD).toBe(4.5);
  });

  it("usdtD takes priority (risk_off_usdt before btc_trend)", () => {
    // High btcD but also high usdtD → risk_off_usdt wins
    const r = getDominancePhase(60, 5.8);
    expect(r.phase).toBe("risk_off_usdt");
  });
});

// ─────────────────────────────────────────────────────────────
// getMarketSummary
// ─────────────────────────────────────────────────────────────

describe("getMarketSummary()", () => {
  it("fg ≥ 75 + usdtD < 5.0 → risk_on_caution", () => {
    const r = getMarketSummary(80, 4.0);
    expect(r.cls).toBe("risk_on_caution");
  });

  it("fg ≤ 25 → risk_off", () => {
    const r = getMarketSummary(20, 3.0);
    expect(r.cls).toBe("risk_off");
  });

  it("usdtD ≥ 5.8 → risk_off", () => {
    const r = getMarketSummary(50, 6.0);
    expect(r.cls).toBe("risk_off");
  });

  it("fg 55-74 + usdtD < 5.5 → risk_on_healthy", () => {
    const r = getMarketSummary(65, 5.0);
    expect(r.cls).toBe("risk_on_healthy");
  });

  it("fg 30-54 → neutral", () => {
    const r = getMarketSummary(45, 4.0);
    expect(r.cls).toBe("neutral");
  });

  it("edge case → undecided (fg low-mid, usdtD medium)", () => {
    // fg=28 (below 30), usdtD=5.2 (below 5.8 but above 5.5)
    // fg > 25 (not risk_off), not ≥75, not 55-74, not 30-54 → undecided
    const r = getMarketSummary(28, 5.2);
    expect(r.cls).toBe("undecided");
  });

  it("returns icon and text", () => {
    const r = getMarketSummary(65, 4.0);
    expect(typeof r.icon).toBe("string");
    expect(r.icon.length).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("risk_on_caution boundary: fg exactly 75, usdtD < 5.0", () => {
    const r = getMarketSummary(75, 4.0);
    expect(r.cls).toBe("risk_on_caution");
  });

  it("risk_off boundary: fg exactly 25", () => {
    const r = getMarketSummary(25, 3.0);
    expect(r.cls).toBe("risk_off");
  });

  it("risk_on_healthy boundary: fg exactly 55, usdtD=5.0", () => {
    const r = getMarketSummary(55, 5.0);
    expect(r.cls).toBe("risk_on_healthy");
  });

  it("MACRO_CONSTANTS values are in expected range", () => {
    expect(MACRO_CONSTANTS.FG_THRESHOLD_FEAR).toBe(25);
    expect(MACRO_CONSTANTS.FG_THRESHOLD_CAUTION).toBe(45);
    expect(MACRO_CONSTANTS.FG_THRESHOLD_NEUTRAL).toBe(55);
    expect(MACRO_CONSTANTS.FG_THRESHOLD_GREED).toBe(75);
    expect(MACRO_CONSTANTS.USDT_HIGH).toBe(5.5);
    expect(MACRO_CONSTANTS.BTC_DOMINANT_MIN).toBe(55);
  });
});
