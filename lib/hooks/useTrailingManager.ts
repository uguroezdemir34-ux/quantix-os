/**
 * TRAILING MANAGER HOOK — TrailingManager'ı store'larla besler.
 *
 * - AppShell'de tek kez mount edilir
 * - Pozisyon + 4h mum verilerini TrailingManager'a bridge eder
 * - isDemo değişiminde manager yeniden oluşturulur
 */

"use client";

import { useEffect, useRef } from "react";
import { usePositionStore } from "@/lib/store/positionStore";
import { useCandleStore } from "@/lib/store/candleStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { TrailingManager } from "@/lib/trailing/manager";
import { setActiveTrailingManager } from "@/lib/trailing/managerRef";
import { getOkxAdapter } from "@/lib/exchange/okx-adapter";
import { createChannel } from "@/lib/notify/registry";
import type { OkxPosition, OkxKline } from "@/types/okx";
import type { Position } from "@/lib/okx/positions";

/** lib/okx/positions Position → OkxPosition (manager için) */
function toOkxPosition(p: Position): OkxPosition {
  return {
    instId: p.instId,
    posSide: p.posSide,
    pos: p.direction === "SHORT" ? String(-p.size) : String(p.size),
    avgPx: String(p.entryPx),
    markPx: String(p.markPx),
    mgnMode: p.mgnMode,
  };
}

export function useTrailingManager(): void {
  const managerRef = useRef<TrailingManager | null>(null);
  const demoMode = useSettingsStore((s) => s.demoMode);

  useEffect(() => {
    // Stop mevcut manager varsa
    managerRef.current?.stop();

    const adapter = getOkxAdapter(demoMode);
    const telegram = createChannel("telegram");

    const manager = new TrailingManager(
      {
        getPositions(): readonly OkxPosition[] {
          return usePositionStore.getState().positions.map(toOkxPosition);
        },

        async getKlines(pair: string, tf: string, limit: number): Promise<OkxKline[]> {
          const key = `${pair}_${tf}`;
          const candles = useCandleStore.getState().candles[key] ?? [];
          const slice = candles.slice(-limit);
          return slice.map((c) => ({
            t: c.ts,
            o: c.open,
            h: c.high,
            l: c.low,
            c: c.close,
            v: c.v,
          }));
        },

        async cancelAlgoOrders(instId: string): Promise<boolean> {
          const result = await adapter.cancelAlgoOrders(instId);
          return result.ok;
        },

        async closePosition(pos: OkxPosition): Promise<{ ok: boolean; err?: string }> {
          const posSide =
            pos.posSide === "long" || pos.posSide === "short"
              ? pos.posSide
              : undefined;
          const result = await adapter.closePosition({
            instId: pos.instId,
            mgnMode: pos.mgnMode ?? "cross",
            posSide,
          });
          if (result.ok) {
            usePositionStore.getState().removePosition(pos.instId);
          }
          return result.ok
            ? { ok: true }
            : { ok: false, err: result.errorMessage };
        },

        sendTelegram(message: string): void {
          if (telegram.isImplemented && telegram.isConfigured()) {
            // Fire-and-forget — trailing stop bildirimleri için
            void telegram.send({
              kind: "trade_closed",
              pair: "BTC", // manager mesaj olarak geçiyor ama pair bilgisi yok — raw mesaj
              timestamp: Date.now(),
            }).catch(() => {/* ignore */});
          }
          console.log("[Trail]", message);
        },

        isDemoMode(): boolean {
          return demoMode;
        },

        storage: typeof window !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      },
    );

    manager.load();
    manager.start();
    managerRef.current = manager;
    setActiveTrailingManager(manager);

    return () => {
      manager.stop();
      setActiveTrailingManager(null);
    };
  }, [demoMode]);
}
