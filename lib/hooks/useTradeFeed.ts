"use client";

/**
 * USE TRADE FEED — OKX WS trades kanalını tradeFeedStore'a besler.
 *
 * Throttle: WS mesajları 200ms'de bir batched olarak ingest edilir.
 * Bu, saniyede onlarca gelen trade mesajının her birinde store update
 * tetiklenmesini önler → render storm yok.
 */

import { useEffect } from "react";
import { useTradeFeedStore } from "@/lib/store/tradeFeedStore";
import type { Pair } from "@/lib/constants/pairs";
import type { OkxTradeRaw } from "@/lib/orderflow/types";
import { getActiveMarketClient } from "@/lib/ws/marketClientRef";

const THROTTLE_MS = 200;

export function useTradeFeed(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const client = getActiveMarketClient();
    if (!client) return;

    const { ingest, setConnection } = useTradeFeedStore.getState();

    // Batch buffer: pair → birikmiş raw trade'ler
    const pending: Partial<Record<Pair, OkxTradeRaw[]>> = {};
    let timer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      timer = null;
      for (const pair of Object.keys(pending) as Pair[]) {
        const raws = pending[pair];
        if (raws && raws.length > 0) {
          ingest(pair, raws);
          pending[pair] = [];
        }
      }
    }

    const unsubTrades = client.onTradeRaw((pair: Pair, raws: OkxTradeRaw[]) => {
      if (!pending[pair]) pending[pair] = [];
      pending[pair]!.push(...raws);
      if (!timer) timer = setTimeout(flush, THROTTLE_MS);
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
      if (timer) clearTimeout(timer);
      unsubTrades();
      unsubStatus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
