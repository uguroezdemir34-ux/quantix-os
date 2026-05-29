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
import { checkDataHealth } from "./circuit-breaker";
import { computeEquityCurveDecision } from "@/lib/risk/equity-curve";
import { checkCorrelationLimit } from "@/lib/risk/correlation";
import { checkExposure } from "@/lib/risk/exposure";

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
  // 0. Veri sağlığı (circuit breaker) — veri donmuşsa diğer kontrollerin anlamı yok
  if (input.accountState.dataHealth !== undefined) {
    const { connectionStatus, lastTickAt } = input.accountState.dataHealth;
    const health = checkDataHealth(connectionStatus, lastTickAt, now);
    if (!health.healthy) {
      return {
        passed: false,
        decision: "blocked_data_frozen",
        reasonHuman: health.reason ?? "Price data unavailable",
      };
    }
  }

  // 0b. Equity curve (haftalık/aylık drawdown) — günlük drawdown check'inden önce
  if (input.accountState.equityCurve !== undefined) {
    const eq = computeEquityCurveDecision({
      dailyPnlPct: 0, // günlük zaten ayrı kontrol ediliyor (#2)
      weeklyPnlPct: input.accountState.equityCurve.weeklyPnlPct,
      monthlyPnlPct: input.accountState.equityCurve.monthlyPnlPct,
    });
    if (eq.tier === "locked" && eq.triggeredBy !== "daily") {
      return {
        passed: false,
        decision: "blocked_equity_curve",
        reasonHuman: eq.reason,
      };
    }
  }

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

  // 5. Korelasyon limiti — aynı yönde çok fazla açık pozisyon
  if (input.accountState.openPositions !== undefined) {
    const direction = input.signal.direction;
    if (direction === "LONG" || direction === "SHORT") {
      const corrCheck = checkCorrelationLimit(
        input.pair,
        direction,
        input.accountState.openPositions,
        input.accountState.correlationConfig,
      );
      if (corrCheck.blocked) {
        return {
          passed: false,
          decision: "blocked_correlation",
          reasonHuman: corrCheck.reason ?? "Correlation limit exceeded",
        };
      }
    }
  }

  // 5b. Exposure cap kontrolü — kümülatif margin equity'nin %25'ini aşamaz
  if (
    input.accountState.openPositionsWithMargin !== undefined &&
    input.accountState.equityUsd !== undefined
  ) {
    const direction = input.signal.direction;
    if (direction === "LONG" || direction === "SHORT") {
      // input.qty × livePrice / leverage → margin estimate
      // Preflight'ta kesin margin yoksa requestedMargin=0 ile sadece current
      // durumu kontrol ediyoruz (conservative: mevcut durum bile limit aşıyorsa bloke)
      const estimatedMargin =
        input.qty > 0 && input.livePrice > 0 && input.leverage > 0
          ? (input.qty * input.livePrice) / input.leverage
          : 1; // en az 1 USD talep et (sıfır talep = her zaman allowed)

      const exposureCheck = checkExposure(
        estimatedMargin,
        direction,
        input.accountState.equityUsd,
        input.accountState.openPositionsWithMargin,
        input.accountState.exposureConfig,
      );

      if (exposureCheck.verdict === "blocked") {
        return {
          passed: false,
          decision: "blocked_exposure",
          reasonHuman: exposureCheck.reason,
        };
      }
    }
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
