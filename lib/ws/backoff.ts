/**
 * WS BACKOFF — Reconnect delay hesabı.
 * Kaynak: panel_v55_51.html satır 6215 (ws delay formülü).
 *
 * Strateji:
 *   - İlk FAST_RETRY_COUNT (4) deneme: 2s sabit (her URL'i hızlıca dene)
 *   - Sonrası: exponential backoff (3s, 4.5s, 6.75s, ...) max 30s
 *
 * Bu sayede ağ geçici düşse hızlıca toparlar, uzun süre düşmüşse
 * sunucuyu DOS etmez.
 */

import { WS_CONSTANTS } from "./types";

/**
 * Sıradaki reconnect'e kadar ms cinsinden bekleme süresi.
 *
 * @param retryCount Şu ana kadar yapılan toplam reconnect sayısı (1-based ilk = 1)
 * @returns ms delay (min 2000, max 30000)
 *
 * @example
 *   getReconnectDelay(1) === 2000
 *   getReconnectDelay(4) === 2000
 *   getReconnectDelay(5) === 3000        (3000 * 1.5^0)
 *   getReconnectDelay(6) === 4500        (3000 * 1.5^1)
 *   getReconnectDelay(7) === 6750        (3000 * 1.5^2)
 *   getReconnectDelay(20) === 30000      (max cap)
 */
export function getReconnectDelay(retryCount: number): number {
  if (retryCount <= 0) return WS_CONSTANTS.FAST_RETRY_DELAY_MS;
  if (retryCount <= WS_CONSTANTS.FAST_RETRY_COUNT) {
    return WS_CONSTANTS.FAST_RETRY_DELAY_MS;
  }
  const step = Math.min(
    retryCount - WS_CONSTANTS.FAST_RETRY_COUNT,
    WS_CONSTANTS.MAX_BACKOFF_STEPS,
  );
  const delay =
    WS_CONSTANTS.SLOW_RETRY_BASE_MS *
    Math.pow(WS_CONSTANTS.BACKOFF_FACTOR, step - 1);
  return Math.min(WS_CONSTANTS.MAX_RECONNECT_MS, Math.round(delay));
}
