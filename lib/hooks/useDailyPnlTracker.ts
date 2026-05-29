/**
 * DAILY PNL TRACKER — Günlük realized P&L hesaplayıp drawdown protokolü günceller.
 *
 * Kaynak: tradesStore kapanmış trade'leri + accountStore bakiyesi.
 *
 * Mantık:
 *   1. Bugün (yerel saat UTC+0) kapanan gerçek trade'lerin pnlUsd toplamı
 *   2. Gün başı bakiye = balanceTotal - bugünkü net P&L (yaklaşık)
 *   3. dailyPnlPct = todayPnlUsd / startOfDayBalance × 100
 *   4. accountStore.setDailyPnlPct() → computeDrawdownProtocol() → tier güncellenir
 *
 * Tetiklenme: tradesStore.trades değiştiğinde (kapanış anında)
 * Sıfırlama: Gün geçişinde (farklı gün algılanınca)
 */

"use client";

import { useEffect, useRef } from "react";
import { useTradesStore } from "@/lib/store/tradesStore";
import { useAccountStore } from "@/lib/store/accountStore";

/** Epoch ms → yerel "YYYY-MM-DD" */
function toLocalDateStr(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useDailyPnlTracker(): void {
  const trades = useTradesStore((s) => s.trades);
  const setDailyPnlPct = useAccountStore((s) => s.setDailyPnlPct);
  const balanceTotal = useAccountStore((s) => s.balanceTotal);
  const lastDateRef = useRef<string>("");

  useEffect(() => {
    const todayStr = toLocalDateStr(Date.now());

    // Bugün kapanan gerçek (non-paper) trade'lerin net P&L'ini topla
    const todayPnlUsd = trades
      .filter((t) => {
        if (t.status !== "closed" || !t.exit) return false;
        if (t.isPaper) return false; // Demo/paper trade'leri sayma
        return toLocalDateStr(t.exit.closedAt) === todayStr;
      })
      .reduce((sum, t) => sum + (t.exit?.pnlUsd ?? 0), 0);

    // Gün başı bakiye tahmini: balanceTotal - bugünkü net P&L
    // (pozitif P&L varsa bakiye daha büyüktü, negatifse daha küçüktü)
    const startOfDayBalance = balanceTotal - todayPnlUsd;
    const safeBase = startOfDayBalance > 0 ? startOfDayBalance : balanceTotal;

    const dailyPnlPct = safeBase > 0 ? (todayPnlUsd / safeBase) * 100 : 0;

    // Gün geçişinde sıfırla
    if (lastDateRef.current !== todayStr) {
      lastDateRef.current = todayStr;
      if (todayPnlUsd === 0) {
        setDailyPnlPct(0);
        return;
      }
    }

    setDailyPnlPct(dailyPnlPct);
  }, [trades, balanceTotal, setDailyPnlPct]);
}
