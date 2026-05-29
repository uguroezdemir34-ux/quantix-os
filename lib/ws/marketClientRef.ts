/**
 * MARKET CLIENT REF — Singleton OkxWsClient referansını dışa açar.
 *
 * useMarketStream hook'u client'ı oluşturur. useTradeFeed gibi hook'lar
 * aynı WS bağlantısını paylaşmak için bu ref'i okur.
 *
 * Circular dependency kaçınmak için useMarketStream buradan import etmez;
 * useTradeFeed ise client.ts'e bağımlı değildir.
 */

import type { OkxWsClient } from "./client";

let _activeClient: OkxWsClient | null = null;

export function setActiveMarketClient(client: OkxWsClient | null): void {
  _activeClient = client;
}

export function getActiveMarketClient(): OkxWsClient | null {
  return _activeClient;
}
