/**
 * WS URLS — Endpoint listesi ve rotasyon mantığı.
 * Kaynak: panel_v55_51.html satır 6079-6094.
 *
 * Sıralama: OKX 3 endpoint (TR'de denenmiş + çalışan) ÖNCE,
 *          Binance 2 endpoint sonra (TR ISP'ları bazen Binance'ı sessizce
 *          drop edip "açılı kabul ediyor ama veri yok" gönderiyor).
 *
 * Sadece BTC + ETH subscribe ediyoruz (v2 strategy: 2 pair).
 */

import type { WsEndpoint } from "./types";

/**
 * Subscribe edilecek instrument'lar (OKX format).
 * BTC + ETH SWAP — paneldeki v2 strategy.
 */
const OKX_INSTRUMENTS = ["BTC-USDT-SWAP", "ETH-USDT-SWAP"] as const;

/**
 * Binance stream URL parametresi (combined stream).
 * Lowercase + @ticker format.
 */
const BINANCE_STREAMS = "btcusdt@ticker/ethusdt@ticker";

/**
 * Tüm WS endpoint'leri, deneme sırasına göre.
 *
 * Sıralama nedeni:
 *   1-3: OKX (TR'de 20-Apr-2026 testinde sorunsuz çalıştı)
 *   4-5: Binance (TR carrier filter şüphesi var — silence watchdog tetikleyebilir)
 */
export const WS_ENDPOINTS: readonly WsEndpoint[] = [
  {
    url: "wss://ws.okx.com:8443/ws/v5/public",
    type: "okx",
    subscribeMessage: {
      op: "subscribe",
      args: OKX_INSTRUMENTS.flatMap((instId) => [
        { channel: "tickers", instId },
        { channel: "trades", instId },
      ]),
    },
  },
  {
    url: "wss://wsaws.okx.com:8443/ws/v5/public",
    type: "okx",
    subscribeMessage: {
      op: "subscribe",
      args: OKX_INSTRUMENTS.flatMap((instId) => [
        { channel: "tickers", instId },
        { channel: "trades", instId },
      ]),
    },
  },
  {
    url: "wss://ws.okx.com/ws/v5/public",
    type: "okx",
    subscribeMessage: {
      op: "subscribe",
      args: OKX_INSTRUMENTS.flatMap((instId) => [
        { channel: "tickers", instId },
        { channel: "trades", instId },
      ]),
    },
  },
  {
    url: `wss://fstream.binance.com/stream?streams=${BINANCE_STREAMS}`,
    type: "binance",
    // Binance combined stream URL'de auto-subscribe, mesaj yok
  },
  {
    url: `wss://stream.binance.com:9443/stream?streams=${BINANCE_STREAMS}`,
    type: "binance",
  },
] as const;

/**
 * Rotation: bir önceki endpoint'in index'ini al, sıradakine geç.
 *
 * @param prevIdx Önceki kullanılan index (0-based)
 * @returns Sıradaki endpoint + onun index'i
 *
 * @example
 *   getNextEndpoint(0) → { endpoint: WS_ENDPOINTS[1], idx: 1 }
 *   getNextEndpoint(4) → { endpoint: WS_ENDPOINTS[0], idx: 0 }  (wrap around)
 */
export function getNextEndpoint(prevIdx: number): {
  endpoint: WsEndpoint;
  idx: number;
} {
  const idx = ((prevIdx + 1) % WS_ENDPOINTS.length + WS_ENDPOINTS.length) %
    WS_ENDPOINTS.length;
  return { endpoint: WS_ENDPOINTS[idx], idx };
}

/**
 * İlk endpoint (rotation başlatıcı).
 */
export function getFirstEndpoint(): { endpoint: WsEndpoint; idx: number } {
  return { endpoint: WS_ENDPOINTS[0], idx: 0 };
}
