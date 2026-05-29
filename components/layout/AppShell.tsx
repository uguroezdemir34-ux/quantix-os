"use client";

/**
 * APP SHELL — Sayfa düzeni wrapper'ı.
 *
 * Yapı:
 *   ┌─ AppHeader (sticky top) ─┐
 *   │                          │
 *   │   {children}             │
 *   │   (sayfa içeriği)        │
 *   │                          │
 *   └─ BottomNav (fixed) ──────┘
 *
 * Content area:
 *   - max-w-2xl (mobile-first, tablet'te merkez)
 *   - padding-bottom: 64px + safe-area (bottom nav için)
 *   - mx-auto px-4
 *
 * Side-effects:
 *   - settingsStore.rehydrate() — localStorage → store
 *   - useMarketStream() — WS bağlantısı + tick stream
 */

import { useEffect } from "react";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useMarketStream } from "@/lib/ws/useMarketStream";
import { useCandlePoller } from "@/lib/hooks/useCandlePoller";
import { usePositionPoller } from "@/lib/hooks/usePositionPoller";
import { useScoreEngine } from "@/lib/hooks/useScoreEngine";

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const rehydrate = useSettingsStore((s) => s.rehydrate);

  // Real-time market data stream (BTC + ETH WS bağlantısı)
  useMarketStream();
  // Candle polling (30s)
  useCandlePoller();
  // Position polling (10s)
  usePositionPoller();
  // Score engine (candle değişince tetiklenir)
  useScoreEngine();

  useEffect(() => {
    rehydrate();
  }, [rehydrate]);

  return (
    <div className="bg-bg text-text-t1 min-h-screen">
      <AppHeader />
      <main
        className="mx-auto max-w-2xl px-4 pb-24 pt-4"
        style={{
          paddingBottom: "calc(64px + env(safe-area-inset-bottom) + 16px)",
        }}
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
