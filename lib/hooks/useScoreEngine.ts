/**
 * SCORE ENGINE HOOK — candleStore + store'lardan ScoreInput oluşturup
 * computeScore çalıştırır, sonucu scoreStore'a yazar.
 *
 * - candleStore değiştiğinde (her 30s) yeniden hesaplar
 * - Her iki pair için paralel çalışır
 */

"use client";

import { useEffect } from "react";
import { PAIRS } from "@/lib/constants/pairs";
import { useCandleStore } from "@/lib/store/candleStore";
import { useMarketStore } from "@/lib/store/marketStore";
import { useMacroStore } from "@/lib/store/macroStore";
import { useRiskStore } from "@/lib/store/riskStore";
import { useAccountStore } from "@/lib/store/accountStore";
import { usePositionStore } from "@/lib/store/positionStore";
import { useTradesStore } from "@/lib/store/tradesStore";
import { useScoreStore } from "@/lib/store/scoreStore";
import { composeScoreInput } from "@/lib/score/composeScoreInput";
import { computeScore } from "@/lib/score/orchestrator";
import type { Pair } from "@/lib/constants/pairs";

export function useScoreEngine(): void {
  const candleStore = useCandleStore();
  const marketStore = useMarketStore();
  const macroStore = useMacroStore();
  const riskStore = useRiskStore();
  const accountStore = useAccountStore();
  const positionStore = usePositionStore();
  const tradesStore = useTradesStore();
  const setResult = useScoreStore((s) => s.setResult);

  useEffect(() => {
    const now = Date.now();

    for (const pair of PAIRS) {
      const candles4h = candleStore.candles[`${pair}_4h`] ?? [];
      const candles1h = candleStore.candles[`${pair}_1h`] ?? [];
      const candles15m = candleStore.candles[`${pair}_15m`] ?? [];

      const livePrice = marketStore.prices[pair]?.last ?? null;
      const fg = macroStore.fgValue ?? 50;

      const openPositions = positionStore.positions.map((p) => ({
        pair: p.pair,
        direction: p.direction as "LONG" | "SHORT",
      }));

      const trades = tradesStore.trades
        .filter((t) => t.status === "closed" && t.exit != null)
        .map((t) => ({
          score: t.entryContext.score,
          pnlUsd: t.exit!.pnlUsd,
          closedAt: t.exit!.closedAt,
        }));

      const protocol = accountStore.drawdownProtocol;
      const drawdownProtocol = {
        tier: protocol.tier,
        minScore:
          protocol.tier === "locked"
            ? 999
            : protocol.tier === "restricted"
              ? 90
              : protocol.tier === "caution"
                ? 85
                : 80,
        label: protocol.label,
        reason: "",
      };

      const input = composeScoreInput({
        pair,
        livePrice,
        candles4h,
        candles1h,
        candles15m,
        fg,
        eventSkipUntil: null,
        btcCooldownUntil: riskStore.btcCooldownUntil || null,
        btcCooldownReason: riskStore.btcCooldownReason,
        btcSelfCooldownUntil: riskStore.btcSelfCooldownUntil || null,
        lockReleasedAt: riskStore.lockReleasedAt || null,
        openPositions,
        drawdownProtocol,
        trades,
        srModifier: 0,
        sweep15m: { type: null, strength: 0 },
        timeQuality: { quality: 1, reason: "" },
        now,
      });

      if (input) {
        const result = computeScore(input);
        setResult(pair as Pair, result, now);
      }
    }
  }, [
    candleStore.candles,
    marketStore.prices,
    macroStore.fgValue,
    riskStore.btcCooldownUntil,
    accountStore.drawdownProtocol,
  ]);
}
