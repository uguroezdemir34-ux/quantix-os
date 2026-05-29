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
import { useAccountStore } from "@/lib/store/accountStore";
import { useRiskStore } from "@/lib/store/riskStore";
import { useTradesStore } from "@/lib/store/tradesStore";
import { useMarketStream } from "@/lib/ws/useMarketStream";
import { useCandlePoller } from "@/lib/hooks/useCandlePoller";
import { usePositionPoller } from "@/lib/hooks/usePositionPoller";
import { useScoreEngine } from "@/lib/hooks/useScoreEngine";
import { useTrailingManager } from "@/lib/hooks/useTrailingManager";
import { useBalancePoller } from "@/lib/hooks/useBalancePoller";
import { useMacroPoller } from "@/lib/hooks/useMacroPoller";
import { useDailyPnlTracker } from "@/lib/hooks/useDailyPnlTracker";
import { useTradeFeed } from "@/lib/hooks/useTradeFeed";

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const rehydrateSettings = useSettingsStore((s) => s.rehydrate);
  const rehydrateAccount = useAccountStore((s) => s.rehydrate);
  const rehydrateRisk = useRiskStore((s) => s.rehydrate);
  const rehydrateTrades = useTradesStore((s) => s.rehydrate);

  // Real-time market data stream (BTC + ETH WS bağlantısı)
  useMarketStream();
  // Candle polling (30s)
  useCandlePoller();
  // Position polling (10s)
  usePositionPoller();
  // Score engine (candle değişince tetiklenir)
  useScoreEngine();
  // Trailing stop manager (30s tick, demoMode değişiminde yeniden başlar)
  useTrailingManager();
  // Balance poller (60s)
  useBalancePoller();
  // Macro poller: F&G + dominans + funding (5dk)
  useMacroPoller();
  // Günlük P&L takip → drawdown protokol tier güncelle (güvenlik kritik)
  useDailyPnlTracker();
  // Order flow trade feed → tradeFeedStore (CVD/VPIN/SMC için)
  useTradeFeed();

  useEffect(() => {
    rehydrateSettings();
    rehydrateAccount();
    rehydrateRisk();
    rehydrateTrades();
  }, [rehydrateSettings, rehydrateAccount, rehydrateRisk, rehydrateTrades]);

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
