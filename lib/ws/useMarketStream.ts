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
 */

import { useEffect } from "react";
import { OkxWsClient } from "./client";
import { useMarketStore } from "@/lib/store/marketStore";

// Module-level singleton
let activeClient: OkxWsClient | null = null;
let activeSubscriberCount = 0;

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

      const { pushTick, setConnection } = useMarketStore.getState();

      activeClient.onTick(pushTick);
      activeClient.onStatus(setConnection);
    }

    activeSubscriberCount++;

    return () => {
      activeSubscriberCount--;
      // Son subscriber gitti → client'ı destroy et
      if (activeSubscriberCount <= 0 && activeClient) {
        activeClient.destroy();
        activeClient = null;
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
  }
  activeSubscriberCount = 0;
}
