/**
 * LOCKS — Aktif lock'ların hesabı (saf fonksiyon).
 *
 * Lock türleri:
 *   - btc_cooldown: BTC sert hareket sonrası alt-pair bekleme (60dk)
 *   - btc_self_cooldown: BTC için kendi cooldown'u
 *   - account_locked: Drawdown protocol "locked" tier
 *   - lock_ramp: Lock kalktıktan sonra 24h ramp-up (yarım risk)
 */

import type { DrawdownProtocol } from "@/lib/store/accountStore";

/** Lock kind enum (i18n key için) */
export type LockKind =
  | "btc_cooldown"
  | "btc_self_cooldown"
  | "account_locked"
  | "lock_ramp";

export interface ActiveLock {
  kind: LockKind;
  /** Bitiş zamanı (epoch ms) — null = süresiz */
  until: number | null;
  /** Sebep (panel'den, opsiyonel) */
  reason?: string;
  /** UI'da gösterilecek kalan süre (saniye) — undefined = süresiz */
  remainingSec?: number;
}

export interface LockState {
  btcCooldownUntil: number;
  btcCooldownReason: string;
  btcSelfCooldownUntil: number;
  lockReleasedAt: number;
  drawdownProtocol: DrawdownProtocol;
}

/** Lock ramp süresi (24 saat) */
const LOCK_RAMP_MS = 24 * 60 * 60 * 1000;

/**
 * Aktif tüm lock'ları döner.
 *
 * @param state Risk state (lock zamanları + drawdown protocol)
 * @param now Şu an (epoch ms)
 * @param pair Hangi pair için kontrol ediliyor (BTC için BTC-self, alt pair'ler için BTC cooldown)
 */
export function computeActiveLocks(
  state: LockState,
  now: number = Date.now(),
  pair: string = "BTC",
): ActiveLock[] {
  const locks: ActiveLock[] = [];

  // 1. Drawdown locked → her şeyi engeller
  if (state.drawdownProtocol.tier === "locked") {
    locks.push({
      kind: "account_locked",
      until: null,
      reason: state.drawdownProtocol.label,
    });
  }

  // 2. BTC cooldown — alt pair'ler etkilenir
  if (pair !== "BTC" && state.btcCooldownUntil > now) {
    locks.push({
      kind: "btc_cooldown",
      until: state.btcCooldownUntil,
      reason: state.btcCooldownReason || undefined,
      remainingSec: Math.ceil((state.btcCooldownUntil - now) / 1000),
    });
  }

  // 3. BTC self cooldown — BTC pair'ı kendi cooldown'u (örn. consecutive stop sonrası)
  if (pair === "BTC" && state.btcSelfCooldownUntil > now) {
    locks.push({
      kind: "btc_self_cooldown",
      until: state.btcSelfCooldownUntil,
      remainingSec: Math.ceil((state.btcSelfCooldownUntil - now) / 1000),
    });
  }

  // 4. Lock ramp — lock kalktıktan sonraki 24h yarım risk uyarısı
  if (state.lockReleasedAt > 0) {
    const elapsed = now - state.lockReleasedAt;
    if (elapsed >= 0 && elapsed < LOCK_RAMP_MS) {
      locks.push({
        kind: "lock_ramp",
        until: state.lockReleasedAt + LOCK_RAMP_MS,
        remainingSec: Math.ceil((LOCK_RAMP_MS - elapsed) / 1000),
      });
    }
  }

  return locks;
}

/**
 * İşlem açmak engellenir mi? (hard block kontrolü)
 */
export function isHardBlocked(locks: readonly ActiveLock[]): boolean {
  return locks.some(
    (l) =>
      l.kind === "account_locked" ||
      l.kind === "btc_cooldown" ||
      l.kind === "btc_self_cooldown",
  );
}

/**
 * Format: 90 saniye → "1m 30s", 3600 saniye → "1h 0m"
 */
export function formatLockDuration(remainingSec: number): string {
  if (remainingSec <= 0) return "0s";
  const hours = Math.floor(remainingSec / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
