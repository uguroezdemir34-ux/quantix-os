/**
 * MACRO POLLER — F&G, dominans ve funding rate periyodik güncelleme.
 *
 * - İlk yüklemede hemen çeker
 * - Sonra her 5 dakikada günceller (macro data yavaş değişir)
 * - macroStore.refreshAll() yazar
 */

"use client";

import { useEffect, useRef } from "react";
import { useMacroStore } from "@/lib/store/macroStore";

const POLL_INTERVAL_MS = 5 * 60_000; // 5 dakika

export function useMacroPoller(): void {
  const refreshAll = useMacroStore((s) => s.refreshAll);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    refreshAll();
    timerRef.current = setInterval(() => {
      refreshAll();
    }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshAll]);
}
