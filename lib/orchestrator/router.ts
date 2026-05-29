/**
 * ORCHESTRATOR ROUTER — Ana fan-out fonksiyonu.
 *
 * Akış (KRİTİK SIRA):
 *   1. Preflight checks
 *   2. Dedupe check
 *   3. EXECUTION ÖNCE (adapter.openPosition)
 *   4. NOTIFY SONRA (sadece execution success ise)
 *   5. JOURNAL (her durumda)
 *
 * "Execution ÖNCE, Notify SONRA" kuralı: Telegram VIP üyelerine
 * "BTC LONG açıldı" mesajı gitmeden önce gerçekten OKX'te emir gitmiş olmalı.
 * Aksi takdirde takipçiler yanlış bilgiyle hareket eder → para kaybeder → etik/yasal risk.
 */

import type {
  OrchestrateInput,
  OrchestrateOutput,
  OrchestratorDeps,
  OrchestratorDecision,
} from "./types";
import type { DisciplineEntry } from "@/lib/risk/discipline-log";
import type { NotifyMessage, NotifyResult } from "@/lib/notify/types";
import { runPreflightChecks } from "./preflight";
import { buildDedupeKey, signalToOrderInput } from "./types";

/**
 * Ana orchestrate fonksiyonu.
 *
 * @returns Her durumda OrchestrateOutput döner — throw etmez.
 */
export async function orchestrate(
  input: OrchestrateInput,
  deps: OrchestratorDeps,
): Promise<OrchestrateOutput> {
  const now = deps.now ?? Date.now();

  // ─── 1. Preflight checks ───
  const preflight = runPreflightChecks(input, now);
  if (!preflight.passed) {
    return makeBlockedOutput(preflight.decision, preflight.reasonHuman, input, now);
  }

  // ─── 2. Dedupe check ───
  if (input.signal.direction !== "LONG" && input.signal.direction !== "SHORT") {
    return makeBlockedOutput(
      "blocked_verdict",
      `Invalid direction: ${input.signal.direction}`,
      input,
      now,
    );
  }
  const dedupeKey = buildDedupeKey(input.pair, input.signal.direction, now);
  if (deps.dedupeStore.isDuplicate(dedupeKey, now)) {
    return makeBlockedOutput(
      "blocked_dedup",
      `Duplicate signal in 30s window: ${dedupeKey}`,
      input,
      now,
    );
  }

  // Kaydet — execution başlamadan dedupe pencere açılır
  deps.dedupeStore.record(dedupeKey, now);

  // ─── 3. EXECUTION ÖNCE ───
  const orderInput = signalToOrderInput(input);
  if (!orderInput) {
    return makeBlockedOutput(
      "blocked_verdict",
      `Cannot build order input`,
      input,
      now,
    );
  }
  const tradeResult = await deps.adapter.openPosition(orderInput);

  if (!tradeResult.ok) {
    // Execution failed → notify GÖNDERME
    return {
      ok: false,
      decision: "failed_exchange",
      reasonHuman: `Exchange order failed: ${tradeResult.errorKind ?? "unknown"} — ${tradeResult.errorMessage ?? ""}`,
      tradeResult,
      notifyResults: [],
      journalEntry: buildJournalEntry(
        "failed_exchange",
        input,
        now,
        tradeResult.errorMessage,
      ),
    };
  }

  // ─── 4. NOTIFY SONRA (execution confirmed) ───
  const notifyMsg = buildNotifyMessage(input, now);
  const notifyResults: NotifyResult[] = [];
  for (const channel of deps.channels) {
    try {
      const r = await channel.send(notifyMsg);
      notifyResults.push(r);
    } catch (e) {
      // Notify hatası execution'ı etkilemez — log + devam
      notifyResults.push({
        ok: false,
        channel: channel.name,
        errorMessage: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  // ─── 5. JOURNAL ───
  return {
    ok: true,
    decision: "executed",
    reasonHuman: `Trade executed: ${input.pair} ${input.signal.direction} @ ${input.livePrice}`,
    tradeResult,
    notifyResults,
    journalEntry: buildJournalEntry("executed", input, now),
  };
}

// ═══════════════ HELPERS ═══════════════

function makeBlockedOutput(
  decision: OrchestratorDecision,
  reasonHuman: string,
  input: OrchestrateInput,
  now: number,
): OrchestrateOutput {
  return {
    ok: false,
    decision,
    reasonHuman,
    notifyResults: [],
    journalEntry: buildJournalEntry(decision, input, now, reasonHuman),
  };
}

function buildJournalEntry(
  decision: OrchestratorDecision,
  input: OrchestrateInput,
  now: number,
  extraReason?: string,
): DisciplineEntry {
  // Decision → DisciplineEventType mapping
  let type: string;
  if (decision === "executed") {
    type = "trade_open";
  } else if (
    decision === "blocked_drawdown" ||
    decision === "blocked_lock" ||
    decision === "blocked_daily_limit"
  ) {
    type = "rule_violation";
  } else if (decision === "blocked_dedup") {
    type = "rule_violation";
  } else if (decision === "failed_exchange") {
    type = "rule_violation";
  } else {
    type = "verdict_no";
  }

  return {
    ts: now,
    type,
    pair: input.pair,
    direction: input.signal.direction,
    score: input.signal.score,
    decision,
    source: input.source,
    reason: extraReason,
  } as DisciplineEntry;
}

function buildNotifyMessage(
  input: OrchestrateInput,
  now: number,
): NotifyMessage {
  if (input.signal.direction !== "LONG" && input.signal.direction !== "SHORT") {
    // Tip darlığı — bu aşamada direction LONG/SHORT olmalı (preflight geçti)
    return {
      kind: "trade_opened",
      pair: input.pair,
      timestamp: now,
    };
  }
  return {
    kind: "trade_opened",
    pair: input.pair,
    direction: input.signal.direction,
    entry: input.livePrice,
    stopPrice: input.stopPrice,
    tp1: input.takeProfitPrice,
    score: input.signal.score,
    reasonText: input.signal.reasons?.trend ?? undefined,
    timestamp: now,
  };
}
