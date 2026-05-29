"use client";

/**
 * USE TRADE FEED — OKX WS trades kanalını tradeFeedStore'a besler.
 *
 * useMarketStream ile AYNI singleton client'ı paylaşır (ayrı WS yok).
 * client.onTradeRaw() → tradeFeedStore.ingest() zinciri kurulur.
 *
 * SSR-safe: window kontrolü ile.
 */

import { useEffect } from "react";
import { useTradeFeedStore } from "@/lib/store/tradeFeedStore";
import type { Pair } from "@/lib/constants/pairs";
import type { OkxTradeRaw } from "@/lib/orderflow/types";

// useMarketStream singleton'ına erişmek için module augmentation yerine
// dinamik import (circular dependency kaçınmak için).
import { getActiveMarketClient } from "@/lib/ws/marketClientRef";

export function useTradeFeed(): void {
  const ingest = useTradeFeedStore((s) => s.ingest);
  const setConnection = useTradeFeedStore((s) => s.setConnection);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Singleton client'a erişim — useMarketStream zaten oluşturmuş olmalı
    const client = getActiveMarketClient();
    if (!client) return;

    const unsubTrades = client.onTradeRaw((pair: Pair, raws: OkxTradeRaw[]) => {
      ingest(pair, raws);
    });

    // Connection state — market stream bağlandığında feed de "live" sayılır
    const unsubStatus = client.onStatus((state) => {
      const cs =
        state.status === "connected" || state.status === "silent"
          ? "live"
          : state.status === "connecting"
          ? "connecting"
          : state.status === "disconnected"
          ? "reconnecting"
          : "idle";
      setConnection("BTC", cs);
      setConnection("ETH", cs);
    });

    return () => {
      unsubTrades();
      unsubStatus();
    };
  }, [ingest, setConnection]);
}
