/**
 * BALANCE POLLER — OKX USDT bakiyesini periyodik çeker.
 *
 * - İlk yüklemede hemen çeker
 * - Sonra her 60s'de günceller
 * - accountStore.setBalance() yazar
 */

"use client";

import { useEffect, useRef } from "react";
import { useAccountStore } from "@/lib/store/accountStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { fetchBalance } from "@/lib/okx/balance";

const POLL_INTERVAL_MS = 60_000;

export function useBalancePoller(): void {
  const setBalance = useAccountStore((s) => s.setBalance);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function poll(): Promise<void> {
    const result = await fetchBalance(demoMode);
    if (result) {
      setBalance(result.total, result.free);
    }
  }

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [demoMode]);
}
