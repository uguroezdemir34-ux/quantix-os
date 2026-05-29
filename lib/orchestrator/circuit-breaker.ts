/**
 * CIRCUIT BREAKER — Veri sağlığı kontrolü.
 *
 * İki katman:
 *   1. Price freeze check: son tick'ten bu yana geçen süre > eşik → frozen
 *   2. Connection health: WS silent/disconnected + son tick çok eski → unhealthy
 *
 * Bu modül SAFTIR — I/O yok, sadece girdi → karar.
 * Preflight'ın 0. kontrolü olarak çalışır (herhangi bir trade'den önce).
 *
 * Eşikler:
 *   PRICE_FROZEN_MS  = 15_000 ms → 15 saniye tick gelmezse circuit açık
 *   STALE_WARN_MS    = 8_000  ms → 8 saniye → uyarı ama henüz blok yok
 */

import type { ConnectionStatus } from "@/lib/ws/types";

// ─── Sabitler ───────────────────────────────────────────────

export const CIRCUIT_BREAKER_CONSTANTS = {
  /** Bu süreden uzun tick gelmezse → circuit açık, trade engeli */
  PRICE_FROZEN_MS: 15_000,
  /** Bu süreden uzun tick gelmezse → stale uyarısı (henüz blok yok) */
  STALE_WARN_MS: 8_000,
  /** Bu durumlar "aktif veri yok" sayılır */
  UNHEALTHY_STATUSES: ["silent", "disconnected", "destroyed"] as ConnectionStatus[],
} as const;

// ─── Tipler ─────────────────────────────────────────────────

export type CircuitBreakerStatus = "healthy" | "stale_warn" | "frozen";

export interface PriceFrozenResult {
  status: CircuitBreakerStatus;
  /** Son tick'ten bu yana geçen süre (ms) */
  staleSec: number;
  /** true → trade engellenmeli */
  shouldBlock: boolean;
}

export interface DataHealthResult {
  healthy: boolean;
  /** Engel sebebi (shouldBlock=true ise dolu) */
  reason: string | null;
  frozen: PriceFrozenResult;
}

// ─── Saf Fonksiyonlar ────────────────────────────────────────

/**
 * Son tick zamanından fiyat dondurma durumunu hesapla.
 *
 * @param lastTickAt  Son tick alınan epoch ms (0 = hiç gelmedi)
 * @param now         Şu anki zaman (test için inject edilebilir)
 * @param frozenMs    Eşik — default 15_000
 * @param staleMs     Uyarı eşiği — default 8_000
 */
export function checkPriceFrozen(
  lastTickAt: number,
  now: number,
  frozenMs: number = CIRCUIT_BREAKER_CONSTANTS.PRICE_FROZEN_MS,
  staleMs: number = CIRCUIT_BREAKER_CONSTANTS.STALE_WARN_MS,
): PriceFrozenResult {
  // Hiç tick gelmemişse (lastTickAt=0) → frozen sayılır
  const ageMs = lastTickAt === 0 ? frozenMs : now - lastTickAt;
  const staleSec = Math.round(ageMs / 1000);

  if (ageMs >= frozenMs) {
    return { status: "frozen", staleSec, shouldBlock: true };
  }
  if (ageMs >= staleMs) {
    return { status: "stale_warn", staleSec, shouldBlock: false };
  }
  return { status: "healthy", staleSec, shouldBlock: false };
}

/**
 * Genel veri sağlığı kontrolü — WS durumu + son tick yaşı birlikte değerlendirilir.
 *
 * Engel koşulları (OR):
 *   - Fiyat 15s+ donmuş (checkPriceFrozen → frozen)
 *   - Bağlantı unhealthy (silent/disconnected) VE son tick 15s+ eski
 *
 * @param connectionStatus  WS bağlantı durumu
 * @param lastTickAt        Son tick alınan epoch ms
 * @param now               Şu anki zaman
 */
export function checkDataHealth(
  connectionStatus: ConnectionStatus,
  lastTickAt: number,
  now: number,
): DataHealthResult {
  const frozen = checkPriceFrozen(lastTickAt, now);

  if (frozen.shouldBlock) {
    return {
      healthy: false,
      reason: `Price data frozen for ${frozen.staleSec}s (last tick: ${frozen.staleSec}s ago)`,
      frozen,
    };
  }

  // WS bağlantısı unhealthy VE veri zaten eskiyorsa ayrıca engelle
  const isUnhealthyConn = CIRCUIT_BREAKER_CONSTANTS.UNHEALTHY_STATUSES.includes(
    connectionStatus,
  );
  if (isUnhealthyConn && frozen.status === "stale_warn") {
    return {
      healthy: false,
      reason: `WS ${connectionStatus} and price data ${frozen.staleSec}s stale`,
      frozen,
    };
  }

  return { healthy: true, reason: null, frozen };
}
