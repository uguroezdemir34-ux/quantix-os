/**
 * BTC COOLDOWN — v55.51 ile birebir.
 * Kaynak: panel_v55_51.html satır 7236-7253, 7783-7801.
 *
 * İki cooldown çeşidi:
 *   1. Alt cooldown   (60dk) → BTC oynadığında ETH gibi alt'ları soğuma
 *   2. Self cooldown  (30dk) → BTC kendi spike sonrası kendisine kısa soğuma
 *
 * Tetik koşulları (panel satır 7236-7240):
 *   - 1H mum kapanış değişimi  > %2.0
 *   - 1H intra-bar aralık      > %2.5
 *   - 4H mum değişimi          > %3.0
 *
 * Yenileme: süre dolmadan tekrar hot ise süre uzar (max alınır), sıfırlanmaz.
 *
 * Persistence: `ug52_btccd` key'inde { until, reason, selfUntil } olarak saklanır.
 */

import type { StorageLike } from "@/lib/trailing/persistence";

export interface BtcCooldownState {
  /** Alt'lar için cooldown bitiş timestamp'i (ms). 0 → aktif değil. */
  altUntil: number;
  /** BTC kendisi için cooldown bitiş timestamp'i (ms). 0 → aktif değil. */
  selfUntil: number;
  /** Cooldown sebebi (kullanıcıya gösterilir) */
  reason: string;
}

export interface BtcMovementInput {
  /** 1H mum kapanış değişim yüzdesi (mutlak değer karşılaştırılır) */
  lastClosePct: number;
  /** 1H intra-bar (high-low) aralık yüzdesi */
  lastRangePct: number;
  /** 4H mum değişim yüzdesi (mutlak değer) */
  last4hPct: number;
}

export interface BtcCooldownEvalResult {
  triggered: boolean;
  reason: string;
}

const ALT_COOLDOWN_MS = 60 * 60 * 1000; // 60 dakika
const SELF_COOLDOWN_MS = 30 * 60 * 1000; // 30 dakika
const STORAGE_KEY = "ug52_btccd";

const LS_THRESHOLD_1H_CLOSE = 2.0;
const LS_THRESHOLD_1H_RANGE = 2.5;
const LS_THRESHOLD_4H = 3.0;

/**
 * BTC hareket verilerinden cooldown gerekip gerekmediğini hesapla.
 * Saf fonksiyon — yan etki yok.
 *
 * Panel davranışı: ilk eşleşen koşul kazanır (if/else if/else if).
 */
export function evaluateBtcMovement(
  input: BtcMovementInput,
): BtcCooldownEvalResult {
  if (input.lastClosePct > LS_THRESHOLD_1H_CLOSE) {
    return {
      triggered: true,
      reason: `1H mum kapanış değişimi ${input.lastClosePct.toFixed(2)}%`,
    };
  }
  if (input.lastRangePct > LS_THRESHOLD_1H_RANGE) {
    return {
      triggered: true,
      reason: `1H intra-bar aralık ${input.lastRangePct.toFixed(2)}%`,
    };
  }
  if (input.last4hPct > LS_THRESHOLD_4H) {
    return {
      triggered: true,
      reason: `4H mum değişimi ${input.last4hPct.toFixed(2)}%`,
    };
  }
  return { triggered: false, reason: "" };
}

/**
 * BTC cooldown durumu — kalıcı state.
 * Panel'in ST.btcCooldownUntil + ST.btcSelfCooldownUntil + ST.btcCooldownReason analogu.
 */
export class BtcCooldown {
  private state: BtcCooldownState;
  private storage: StorageLike | null;

  constructor(storage: StorageLike | null = null) {
    this.storage = storage;
    this.state = { altUntil: 0, selfUntil: 0, reason: "" };
    this.load();
  }

  /**
   * BTC hareket verisi ile çağrılır. Eşik aşıldıysa cooldown'u set/uzat.
   *
   * @param now Test edilebilirlik için zaman override
   * @returns triggered → true ise cooldown set edildi/uzatıldı
   */
  applyMovement(input: BtcMovementInput, now: number = Date.now()): BtcCooldownEvalResult {
    const result = evaluateBtcMovement(input);
    if (!result.triggered) return result;

    // Yenileme: max alınır → süre dolmadan tekrar hot ise uzar
    const newAltUntil = now + ALT_COOLDOWN_MS;
    const newSelfUntil = now + SELF_COOLDOWN_MS;
    this.state.altUntil = Math.max(this.state.altUntil, newAltUntil);
    this.state.selfUntil = Math.max(this.state.selfUntil, newSelfUntil);
    this.state.reason = result.reason;
    this.persist();
    return result;
  }

  /**
   * Bir pair için cooldown bloğu kontrol et.
   * BTC için self cooldown (30dk), diğerleri için alt cooldown (60dk).
   *
   * @returns null → bloklanmıyor; object → bloklanmış
   */
  checkBlock(
    pair: string,
    now: number = Date.now(),
  ): { remainMin: number; reason: string } | null {
    if (pair === "BTC") {
      if (this.state.selfUntil > 0 && now < this.state.selfUntil) {
        return {
          remainMin: Math.ceil((this.state.selfUntil - now) / 60000),
          reason: this.state.reason,
        };
      }
      return null;
    }
    // alt pair
    if (this.state.altUntil > 0 && now < this.state.altUntil) {
      return {
        remainMin: Math.ceil((this.state.altUntil - now) / 60000),
        reason: this.state.reason,
      };
    }
    return null;
  }

  /** State temizle — backup restore, mode switch vs için. */
  reset(): void {
    this.state = { altUntil: 0, selfUntil: 0, reason: "" };
    this.persist();
  }

  getState(): Readonly<BtcCooldownState> {
    return this.state;
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          until: this.state.altUntil,
          reason: this.state.reason,
          selfUntil: this.state.selfUntil,
        }),
      );
    } catch {
      // sessizce yut — panel davranışıyla aynı
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        until?: number;
        reason?: string;
        selfUntil?: number;
      };
      this.state.altUntil = parsed.until ?? 0;
      this.state.selfUntil = parsed.selfUntil ?? 0;
      this.state.reason = parsed.reason ?? "";
    } catch {
      // bozuk JSON → state varsayılan kalır
    }
  }
}

// Test ve diğer modüller için sabitleri dışa aç (read-only)
export const BTC_COOLDOWN_CONSTANTS = {
  ALT_COOLDOWN_MS,
  SELF_COOLDOWN_MS,
  THRESHOLD_1H_CLOSE: LS_THRESHOLD_1H_CLOSE,
  THRESHOLD_1H_RANGE: LS_THRESHOLD_1H_RANGE,
  THRESHOLD_4H: LS_THRESHOLD_4H,
  STORAGE_KEY,
} as const;
