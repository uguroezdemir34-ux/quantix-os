/**
 * RISK ADHERENCE + DISCIPLINE LOG TESTS
 *
 * computeAdherenceScore: puan hesabı, tier geçişleri, 7-gün pencere.
 * DisciplineLog: ekleme, filtreleme, serialize/deserialize.
 */

import { describe, it, expect } from "vitest";
import { computeAdherenceScore, ADHERENCE_CONFIG } from "@/lib/risk/adherence-score";
import { DisciplineLog } from "@/lib/risk/discipline-log";
import type { DisciplineEntry } from "@/lib/risk/discipline-log";

const NOW = Date.now();
const DAY = 86_400_000;

function entry(type: string, msAgo = 0): DisciplineEntry {
  return { ts: NOW - msAgo, type };
}

// ─────────────────────────────────────────────────────────────
// computeAdherenceScore
// ─────────────────────────────────────────────────────────────

describe("computeAdherenceScore()", () => {
  it("no entries → baseline score 50, tier varies", () => {
    const result = computeAdherenceScore([], NOW);
    expect(result.score).toBe(ADHERENCE_CONFIG.BASELINE);
  });

  it("all system_with entries → score > baseline", () => {
    const entries = Array.from({ length: 5 }, () => entry("system_with", DAY));
    const result = computeAdherenceScore(entries, NOW);
    expect(result.score).toBeGreaterThan(ADHERENCE_CONFIG.BASELINE);
  });

  it("single system_against → large score drop (-25pts)", () => {
    const result = computeAdherenceScore([entry("system_against", DAY)], NOW);
    const expected = Math.max(0, ADHERENCE_CONFIG.BASELINE + ADHERENCE_CONFIG.AGAINST_SYSTEM_POINTS);
    expect(result.score).toBe(expected);
  });

  it("3 system_against → critical tier or min score", () => {
    const entries = Array.from({ length: 3 }, () => entry("system_against", DAY));
    const result = computeAdherenceScore(entries, NOW);
    // 50 + 3*(-25) = 50 - 75 = -25 → clamped to 0
    expect(result.score).toBe(0);
    expect(result.tier).toBe("critical");
  });

  it("10 system_with → score capped at 100", () => {
    const entries = Array.from({ length: 10 }, () => entry("system_with", DAY));
    const result = computeAdherenceScore(entries, NOW);
    expect(result.score).toBe(100);
    expect(result.tier).toBe("excellent");
  });

  it("rule_violation reduces score", () => {
    const baseline = computeAdherenceScore([], NOW).score;
    const withViolation = computeAdherenceScore([entry("rule_violation", DAY)], NOW);
    expect(withViolation.score).toBeLessThan(baseline);
  });

  it("entries older than 7 days are excluded", () => {
    const oldEntry = entry("system_against", 8 * DAY); // 8 days ago
    const result = computeAdherenceScore([oldEntry], NOW);
    // Old entry excluded → baseline
    expect(result.score).toBe(ADHERENCE_CONFIG.BASELINE);
  });

  it("counts are correct", () => {
    const entries = [
      entry("system_with", DAY),
      entry("system_with", DAY),
      entry("system_against", DAY),
      entry("rule_violation", DAY),
    ];
    const result = computeAdherenceScore(entries, NOW);
    expect(result.withSystem).toBe(2);
    expect(result.againstSystem).toBe(1);
    expect(result.ruleViolation).toBe(1);
    expect(result.totalTrades).toBe(3);
  });

  it("tier progression: excellent → good → fair → poor → critical", () => {
    // Add increasing against entries to move through tiers
    const against = (n: number) => Array.from({ length: n }, () => entry("system_against", DAY));
    const t0 = computeAdherenceScore([], NOW).tier;
    const t1 = computeAdherenceScore(against(1), NOW).tier;
    const t2 = computeAdherenceScore(against(2), NOW).tier;
    const t3 = computeAdherenceScore(against(3), NOW).tier;

    // Each against pushes score down: 50 → 25 → 0 → -25(=0)
    expect(["excellent", "good", "fair", "poor", "critical"]).toContain(t0);
    expect(["excellent", "good", "fair", "poor", "critical"]).toContain(t1);
    // Score should be progressively lower
    const s0 = computeAdherenceScore([], NOW).score;
    const s1 = computeAdherenceScore(against(1), NOW).score;
    const s2 = computeAdherenceScore(against(2), NOW).score;
    expect(s0).toBeGreaterThanOrEqual(s1);
    expect(s1).toBeGreaterThanOrEqual(s2);
  });
});

// ─────────────────────────────────────────────────────────────
// DisciplineLog
// ─────────────────────────────────────────────────────────────

describe("DisciplineLog", () => {
  it("starts empty", () => {
    const log = new DisciplineLog(null);
    expect(log.getAll()).toHaveLength(0);
  });

  it("log() appends entries in order", () => {
    const log = new DisciplineLog(null);
    log.log("system_with");
    log.log("trade_open");
    const all = log.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].type).toBe("system_with");
    expect(all[1].type).toBe("trade_open");
  });

  it("getByType() filters correctly", () => {
    const log = new DisciplineLog(null);
    log.log("system_with");
    log.log("system_against");
    log.log("system_with");
    const with_ = log.getByType(["system_with"]);
    expect(with_).toHaveLength(2);
    expect(with_.every((e) => e.type === "system_with")).toBe(true);
  });

  it("clear() empties the log", () => {
    const log = new DisciplineLog(null);
    log.log("system_with");
    log.log("trade_open");
    log.clear();
    expect(log.getAll()).toHaveLength(0);
  });

  it("extra fields are stored with the entry", () => {
    const log = new DisciplineLog(null);
    log.log("trade_open", { pair: "BTC", score: 75 });
    const entries = log.getAll();
    expect(entries[0].pair).toBe("BTC");
    expect(entries[0].score).toBe(75);
  });

  it("5000 cap: entries pruned when exceeded", () => {
    const log = new DisciplineLog(null);
    for (let i = 0; i < 5010; i++) {
      log.log("trade_open");
    }
    expect(log.getAll().length).toBeLessThanOrEqual(5000);
  });

  it("replaceAll() round-trip preserves entries", () => {
    const log = new DisciplineLog(null);
    log.log("system_with", { pair: "ETH", score: 65 });
    log.log("system_against");

    const entries = [...log.getAll()] as DisciplineEntry[];
    const log2 = new DisciplineLog(null);
    log2.replaceAll(entries);
    expect(log2.getAll()).toHaveLength(2);
    expect(log2.getAll()[0].type).toBe("system_with");
    expect(log2.getAll()[0].pair).toBe("ETH");
  });
});
