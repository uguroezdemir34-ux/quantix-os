/**
 * POSITION POLLER — OKX açık pozisyonlarını periyodik çeker.
 *
 * - İlk yüklemede hemen çeker
 * - Sonra her 10s'de bir günceller
 * - positionStore'u günceller
 */

"use client";

import { useEffect, useRef } from "react";
import { fetchPositions } from "@/lib/okx/positions";
import { usePositionStore } from "@/lib/store/positionStore";

const POLL_INTERVAL_MS = 10_000;

export function usePositionPoller(): void {
  const setPositions = usePositionStore((s) => s.setPositions);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchAll(): Promise<void> {
    const positions = await fetchPositions();
    if (positions !== null) {
      setPositions(positions);
    }
  }

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);
}
