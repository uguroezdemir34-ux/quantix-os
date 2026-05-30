"use client";

/**
 * USE TRADE FEED — OKX WS trades kanalını tradeFeedStore'a besler.
 *
 * Action'lar getState() ile alınır (store subscription yok → re-render yok).
 * Effect sadece mount'ta çalışır, trade mesajları async callback'te işlenir.
 */

import { useEffect } from "react";
import { useTradeFeedStore } from "@/lib/store/tradeFeedStore";
import type { Pair } from "@/lib/constants/pairs";
import type { OkxTradeRaw } from "@/lib/orderflow/types";
import { getActiveMarketClient } from "@/lib/ws/marketClientRef";

export function useTradeFeed(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const client = getActiveMarketClient();
    if (!client) return;

    // getState() — store subscribe etmeden stable action referansı alır
    const { ingest, setConnection } = useTradeFeedStore.getState();

    const unsubTrades = client.onTradeRaw((pair: Pair, raws: OkxTradeRaw[]) => {
      ingest(pair, raws);
    });

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
