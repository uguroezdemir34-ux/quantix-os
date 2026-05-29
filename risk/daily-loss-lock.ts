/**
 * DAILY LOSS LOCK — v55.51 ile birebir state machine.
 * Kaynak: panel_v55_51.html satır 9034-9081.
 *
 * Eski panel UI ile iş mantığını aynı fonksiyonda karıştırıyordu (DOM yazma +
 * lock state'i set etme). v2'de iş mantığı saf, side-effect callback'leri DI:
 *   - onTierChange   → tier ilk değiştiğinde (caution/restricted girişi) toast
 *   - onLocked       → ilk kez locked'a girişte (toast + LS persist + overlay)
 *
 * State: ileride Zustand store'a bağlanacak. Şu an saf class.
 */

import {
  getDrawdownProtocol,
  type DrawdownProtocol,
  type DrawdownTier,
} from "./drawdown-protocol";

export interface DailyLossLockState {
  locked: boolean;
  lockReason: string | null;
  protocol: DrawdownProtocol;
  /** Son toast atılan tier (yeniden toast atılmasın diye) */
  lastTier: DrawdownTier;
}

export interface DailyLossLockEvents {
  /** caution/restricted'a ilk girişte (locked hariç) */
  onTierChange?: (tier: DrawdownTier, protocol: DrawdownProtocol) => void;
  /** Locked'a ilk girişte (LS persist + toast + overlay için) */
  onLocked?: (reason: string) => void;
}

export class DailyLossLock {
  private state: DailyLossLockState;
  private events: DailyLossLockEvents;

  constructor(events: DailyLossLockEvents = {}) {
    this.events = events;
    this.state = {
      locked: false,
      lockReason: null,
      protocol: getDrawdownProtocol(0),
      lastTier: "normal",
    };
  }

  /**
   * Bakiye güncelleme ile çağrılır. Panel `checkDailyLossLock` analogu.
   * pnlPct = bugünün başlangıç bakiyesine göre günlük P&L yüzdesi.
   */
  update(pnlPct: number): DrawdownProtocol {
    const protocol = getDrawdownProtocol(pnlPct);
    this.state.protocol = protocol;

    // Locked tier'a ilk geçiş → yan etki bir kez
    if (protocol.tier === "locked" && !this.state.locked) {
      this.state.locked = true;
      this.state.lockReason = `Günlük kayıp limiti aşıldı (%${pnlPct.toFixed(1)}).`;
      this.events.onLocked?.(this.state.lockReason);
    }

    // Caution/restricted'a ilk geçiş — bilgilendirici toast
    // Panel davranışı: locked ve normal hariç (panel satır 9073-9079)
    if (
      protocol.tier !== this.state.lastTier &&
      protocol.tier !== "normal" &&
      protocol.tier !== "locked"
    ) {
      this.events.onTierChange?.(protocol.tier, protocol);
    }

    this.state.lastTier = protocol.tier;
    return protocol;
  }

  /** Mevcut tier protokolü (UI okur). */
  getProtocol(): DrawdownProtocol {
    return this.state.protocol;
  }

  /** Kilit durumu (UI overlay için). */
  isLocked(): boolean {
    return this.state.locked;
  }

  getLockReason(): string | null {
    return this.state.lockReason;
  }

  /** Yeni gün başında veya manuel reset için. Panel davranışıyla aynı. */
  reset(): void {
    this.state.locked = false;
    this.state.lockReason = null;
    this.state.lastTier = "normal";
    this.state.protocol = getDrawdownProtocol(0);
  }
}
