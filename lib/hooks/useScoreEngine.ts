/**
 * SCORE ENGINE HOOK — candleStore tetiklendiğinde ScoreInput oluşturup
 * computeScore çalıştırır, sonucu scoreStore'a yazar.
 *
 * Render optimizasyonu:
 *   - Yalnızca candleStore.candles değiştiğinde (her ~30s) hesaplar
 *   - Diğer store'lar getState() ile okunur — subscription yok, re-render yok
 */

"use client";

import { useEffect } from "react";
import { PAIRS } from "@/lib/constants/pairs";
import { useCandleStore, EMPTY_CANDLES } from "@/lib/store/candleStore";
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
  // Tek trigger: mum verisi değişimi (~30s). Diğer store'lar getState() ile okunur.
  const candles = useCandleStore((s) => s.candles);
  const setResult = useScoreStore((s) => s.setResult);

  useEffect(() => {
    const now = Date.now();

    // Snapshot — subscription yok, re-render tetiklemiyor
    const marketStore = useMarketStore.getState();
    const macroStore = useMacroStore.getState();
    const riskStore = useRiskStore.getState();
    const accountStore = useAccountStore.getState();
    const positionStore = usePositionStore.getState();
    const tradesStore = useTradesStore.getState();

    for (const pair of PAIRS) {
      const candles4h = candles[`${pair}_4h`] ?? EMPTY_CANDLES;
      const candles1h = candles[`${pair}_1h`] ?? EMPTY_CANDLES;
      const candles15m = candles[`${pair}_15m`] ?? EMPTY_CANDLES;

      const livePrice = marketStore.prices[pair]?.last ?? null;
      const fg = macroStore.fgValue ?? 50;
      const fundingResult =
        pair === "BTC" ? macroStore.fundingBtc : macroStore.fundingEth;
      const fundingRate = fundingResult?.fundingRate ?? null;

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        candles4h: candles4h as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        candles1h: candles1h as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        candles15m: candles15m as any,
        fg,
        eventSkipUntil: null,
        btcCooldownUntil: riskStore.btcCooldownUntil || null,
        btcCooldownReason: riskStore.btcCooldownReason,
        btcSelfCooldownUntil: riskStore.btcSelfCooldownUntil || null,
        lockReleasedAt: riskStore.lockReleasedAt || null,
        openPositions,
        drawdownProtocol,
        trades,
        fundingRate,
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
  }, [candles, setResult]);
}
