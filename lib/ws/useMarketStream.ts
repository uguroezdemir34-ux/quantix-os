"use client";

/**
 * USE MARKET STREAM — React hook ile WS client orchestration.
 *
 * Mantık:
 *   - Sayfa mount'a olduğunda bir defa WS client'ı başlatır
 *   - Tick gelince marketStore.pushTick() çağrılır
 *   - Status değişince marketStore.setConnection() çağrılır
 *   - Sayfa unmount'a olduğunda client.destroy() çağrılır
 *
 * SINGLETON PATTERN:
 *   - Birden fazla component bu hook'u kullansa bile **tek bir client**
 *     instance'ı oluşturulur. Aynı WS bağlantısını paylaşırlar.
 *   - HMR (hot module reload) sırasında eski client temizlenir.
 *
 * REST TICKER FALLBACK:
 *   - WS "silent" veya "disconnected" olduğunda REST ticker devreye girer.
 *   - Her 3 saniyede bir /api/okx/api/v5/market/ticker ile fiyat çeker.
 *   - WS geri döndüğünde (connected) fallback poller durur.
 */

import { useEffect } from "react";
import { PAIRS } from "@/lib/constants/pairs";
import { OkxWsClient } from "./client";
import type { ConnectionState } from "./types";
import { useMarketStore } from "@/lib/store/marketStore";
import { setActiveMarketClient } from "./marketClientRef";
import { fetchRestTicker } from "@/lib/okx/ticker";

// Module-level singleton
let activeClient: OkxWsClient | null = null;
let activeSubscriberCount = 0;

// REST fallback poller
const REST_FALLBACK_INTERVAL_MS = 3_000;
let restFallbackTimer: ReturnType<typeof setInterval> | null = null;

function startRestFallback(): void {
  if (restFallbackTimer !== null) return; // zaten çalışıyor
  restFallbackTimer = setInterval(async () => {
    const { pushTick } = useMarketStore.getState();
    const now = Date.now();
    await Promise.all(
      PAIRS.map(async (pair) => {
        const tick = await fetchRestTicker(pair, now);
        if (tick) pushTick(tick);
      }),
    );
  }, REST_FALLBACK_INTERVAL_MS);
}

function stopRestFallback(): void {
  if (restFallbackTimer === null) return;
  clearInterval(restFallbackTimer);
  restFallbackTimer = null;
}

function handleStatusChange(state: ConnectionState): void {
  useMarketStore.getState().setConnection(state);

  if (state.status === "silent" || state.status === "disconnected") {
    startRestFallback();
  } else if (state.status === "connected") {
    stopRestFallback();
  }
}

/**
 * Component'in WS stream'e bağlanmasını sağlar.
 * Birden fazla component çağırırsa singleton paylaşılır.
 *
 * @returns void (UI verisi marketStore'dan okunur)
 */
export function useMarketStream(): void {
  useEffect(() => {
    // Browser only
    if (typeof window === "undefined") return;

    // İlk subscriber → client'ı oluştur ve başlat
    if (!activeClient) {
      activeClient = new OkxWsClient({ autoConnect: true });
      setActiveMarketClient(activeClient);

      const { pushTick } = useMarketStore.getState();

      activeClient.onTick(pushTick);
      activeClient.onStatus(handleStatusChange);
    }

    activeSubscriberCount++;

    return () => {
      activeSubscriberCount--;
      // Son subscriber gitti → client'ı destroy et
      if (activeSubscriberCount <= 0 && activeClient) {
        stopRestFallback();
        activeClient.destroy();
        activeClient = null;
        setActiveMarketClient(null);
        activeSubscriberCount = 0;
        useMarketStore.getState().reset();
      }
    };
  }, []);
}

/**
 * Test helper — module-level singleton'ı temizle.
 * Production'da çağırılmamalı.
 */
export function _resetMarketStreamForTesting(): void {
  if (activeClient) {
    activeClient.destroy();
    activeClient = null;
    setActiveMarketClient(null);
  }
  activeSubscriberCount = 0;
}
