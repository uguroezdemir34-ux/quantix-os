/**
 * ORCHESTRATOR — Sinyal → Execution + Notify + Journal fan-out.
 *
 * Sıralama (KRİTİK):
 *   1. Pre-flight checks (drawdown, lock, daily limit)
 *   2. Dedupe (30sn aynı sinyal var mı?)
 *   3. EXECUTION ÖNCE — borsa emri başarısız → return early
 *   4. NOTIFY SONRA — execution confirm olduğu için
 *   5. JOURNAL — her durumda kayıt
 *
 * Bkz. ARCHITECTURE.md bölüm 4.
 */

import type { ScoreResult } from "@/lib/score/orchestrator";
import type { Pair } from "@/lib/constants/pairs";
import type {
  ExchangeAdapter,
  AdapterResult,
  TradeData,
  OpenPositionInput,
} from "@/lib/exchange/types";
import type { NotifyChannel, NotifyResult } from "@/lib/notify/types";
import type { DrawdownProtocol } from "@/lib/store/accountStore";
import type { DisciplineEntry } from "@/lib/risk/discipline-log";

// ═══════════════ INPUT ═══════════════

/**
 * Orchestrator girdisi — bot veya UI'dan tetiklenir.
 */
export interface OrchestrateInput {
  /** Signal Engine'den gelen verdict */
  signal: ScoreResult;
  pair: Pair;
  /** Anlık piyasa fiyatı (entry için referans) */
  livePrice: number;
  /** Hesaplanan emir miktarı (Position Sizer'dan) */
  qty: number;
  /** SL fiyatı (Position Sizer'dan) */
  stopPrice: number;
  /** TP fiyatları */
  takeProfitPrice?: number;
  leverage: number;
  marginMode: "cross" | "isolated";
  /** Tetik kaynağı (manuel UI veya otomatik bot) */
  source: "manual" | "bot";
  /** Mevcut hesap durumu — preflight için */
  accountState: AccountStateSnapshot;
}

export interface AccountStateSnapshot {
  drawdownProtocol: DrawdownProtocol;
  btcCooldownUntil: number; // 0 = aktif değil
  btcSelfCooldownUntil: number;
  /** Bugün açılmış trade sayısı */
  todayTradeCount: number;
  /** Günlük max trade limiti (default 2) */
  maxTradesPerDay: number;
}

// ═══════════════ DECISION ═══════════════

/**
 * Orchestrator kararı — neden tetiklendi/tetiklenmedi.
 * UI ve log için insanca açıklama bu enum üzerinden.
 */
export type OrchestratorDecision =
  // Başarılı
  | "executed"
  // Engellenen
  | "blocked_verdict" // verdict !== 'go'
  | "blocked_drawdown" // tier === 'locked'
  | "blocked_lock" // BTC cooldown veya self cooldown
  | "blocked_daily_limit" // todayTradeCount >= maxTradesPerDay
  | "blocked_dedup" // son 30sn'de aynı sinyal var
  // Başarısız
  | "failed_exchange"; // adapter.openPosition başarısız

// ═══════════════ OUTPUT ═══════════════

export interface OrchestrateOutput {
  /** Başarılı mı (executed) */
  ok: boolean;
  decision: OrchestratorDecision;
  /** İnsanca açıklama (UI/log için) */
  reasonHuman: string;
  /** Trade açıldıysa adapter sonucu */
  tradeResult?: AdapterResult<TradeData>;
  /** Notify kanallarının sonuçları */
  notifyResults: NotifyResult[];
  /** Journal kaydı */
  journalEntry: DisciplineEntry;
}

// ═══════════════ DEPS ═══════════════

/**
 * Orchestrator dependency injection.
 * Test'lerde mock adapter + mock channel + mock dedupe injection.
 */
export interface OrchestratorDeps {
  adapter: ExchangeAdapter;
  channels: NotifyChannel[];
  dedupeStore: DedupeStore;
  /** Şu an (test'te override) */
  now?: number;
}

// ═══════════════ DEDUPE INTERFACE ═══════════════

/**
 * Idempotency store — aynı sinyal tekrar tekrar tetiklenmesin.
 *
 * In-memory veya localStorage tabanlı olabilir.
 */
export interface DedupeStore {
  /** Bu sinyal son N saniyede tetiklendi mi? */
  isDuplicate(key: string, now?: number): boolean;
  /** Sinyal tetiklendiğini kaydet */
  record(key: string, now?: number): void;
  /** Tüm kayıtları temizle (test için) */
  clear(): void;
}

/**
 * Sinyal kimliği — dedupe key.
 *
 * Format: "<pair>_<direction>_<dakika_bucket>"
 * Aynı pair + yön + dakika içinde tetiklenmiş sinyal duplicate.
 */
export function buildDedupeKey(
  pair: Pair,
  direction: "LONG" | "SHORT",
  now: number,
): string {
  // 30 saniyelik bucket
  const bucket = Math.floor(now / 30000);
  return `${pair}_${direction}_${bucket}`;
}

// ═══════════════ HELPER: ScoreResult → OpenPositionInput ═══════════════

/**
 * Score Engine verdict'inden adapter openPosition input'u oluştur.
 */
export function signalToOrderInput(
  input: OrchestrateInput,
): OpenPositionInput | null {
  const direction = input.signal.direction;
  if (direction !== "LONG" && direction !== "SHORT") {
    return null;
  }
  return {
    pair: input.pair,
    direction,
    qty: input.qty,
    leverage: input.leverage,
    marginMode: input.marginMode,
  };
}
