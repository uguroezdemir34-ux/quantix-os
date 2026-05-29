/**
 * PREFLIGHT CHECKS — Orchestrator emir vermeden önce kontroller.
 *
 * Saf fonksiyonlar — input + now → karar. I/O yok.
 *
 * Sıralama (önemli):
 *   1. Verdict GO mu?
 *   2. Drawdown locked mı?
 *   3. Lock var mı (BTC cooldown / self cooldown)?
 *   4. Günlük max trade aşıldı mı?
 */

import type {
  OrchestrateInput,
  OrchestratorDecision,
  AccountStateSnapshot,
} from "./types";
import type { Pair } from "@/lib/constants/pairs";

export interface PreflightCheckResult {
  passed: boolean;
  decision: OrchestratorDecision;
  reasonHuman: string;
}

/**
 * Tüm preflight kontrollerini sırayla yapar.
 * İlk başarısız check → erken çıkış.
 */
export function runPreflightChecks(
  input: OrchestrateInput,
  now: number = Date.now(),
): PreflightCheckResult {
  // 1. Verdict GO olmalı
  if (input.signal.verdict !== "go") {
    return {
      passed: false,
      decision: "blocked_verdict",
      reasonHuman: `Verdict is "${input.signal.verdict}", expected "go"`,
    };
  }

  // 2. Drawdown locked → her şey engellenir
  if (input.accountState.drawdownProtocol.tier === "locked") {
    return {
      passed: false,
      decision: "blocked_drawdown",
      reasonHuman: `Account locked: ${input.accountState.drawdownProtocol.label}`,
    };
  }

  // 3. Lock kontrolü (BTC veya self cooldown)
  const lockCheck = checkLocks(input.pair, input.accountState, now);
  if (!lockCheck.passed) return lockCheck;

  // 4. Günlük max trade
  if (
    input.accountState.todayTradeCount >= input.accountState.maxTradesPerDay
  ) {
    return {
      passed: false,
      decision: "blocked_daily_limit",
      reasonHuman: `Daily trade limit reached (${input.accountState.todayTradeCount}/${input.accountState.maxTradesPerDay})`,
    };
  }

  return {
    passed: true,
    decision: "executed", // henüz değil, ama preflight passed
    reasonHuman: "All preflight checks passed",
  };
}

/**
 * Lock kontrolü — BTC cooldown (alt pair'ler) veya self cooldown (BTC için).
 */
function checkLocks(
  pair: Pair,
  state: AccountStateSnapshot,
  now: number,
): PreflightCheckResult {
  // BTC cooldown — alt pair'leri engeller
  if (pair !== "BTC" && state.btcCooldownUntil > now) {
    const remainingSec = Math.ceil((state.btcCooldownUntil - now) / 1000);
    return {
      passed: false,
      decision: "blocked_lock",
      reasonHuman: `BTC cooldown active for ${pair}, ${remainingSec}s remaining`,
    };
  }

  // BTC self cooldown — sadece BTC'yi engeller
  if (pair === "BTC" && state.btcSelfCooldownUntil > now) {
    const remainingSec = Math.ceil((state.btcSelfCooldownUntil - now) / 1000);
    return {
      passed: false,
      decision: "blocked_lock",
      reasonHuman: `BTC self cooldown active, ${remainingSec}s remaining`,
    };
  }

  return {
    passed: true,
    decision: "executed",
    reasonHuman: "No locks",
  };
}
