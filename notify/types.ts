/**
 * NOTIFY CHANNEL — Bildirim kanallarının ortak interface'i.
 *
 * Dolu impl: lib/notify/telegram.ts (paket #9)
 * İskelet: discord, email, sms (gelecek)
 *
 * Bkz. ARCHITECTURE.md bölüm 6.
 */

import type { Pair } from "@/lib/constants/pairs";

// ═══════════════ CHANNEL NAME ═══════════════

export type ChannelName = "telegram" | "discord" | "email";

export const SUPPORTED_CHANNELS: readonly ChannelName[] = [
  "telegram",
  "discord",
  "email",
];

// ═══════════════ NOTIFY MESSAGE ═══════════════

/**
 * Bildirim tipi — orchestrator → channel'a hangi olay için mesaj.
 */
export type NotifyKind =
  | "trade_opened"
  | "trade_closed"
  | "sl_hit"
  | "tp_hit"
  | "lock_triggered"
  | "test"; // health check

/**
 * Mesaj payload — channel kendi formatına çevirir.
 */
export interface NotifyMessage {
  kind: NotifyKind;
  pair: Pair;
  direction?: "LONG" | "SHORT";
  entry?: number;
  stopPrice?: number;
  tp1?: number;
  tp2?: number;
  /** Sinyalin gerekçesi (kısa, insanca) */
  reasonText?: string;
  /** Skor 0-100 */
  score?: number;
  /** Ek bilgi (PnL kapanışta vb.) */
  pnl?: number;
  pnlPct?: number;
  /** Mesaj zamanı (epoch ms) — channel format'lar */
  timestamp?: number;
}

// ═══════════════ RESULT ═══════════════

export interface NotifyResult {
  ok: boolean;
  /** Channel adı (audit için) */
  channel: ChannelName;
  /** Channel-specific mesaj/hata */
  errorMessage?: string;
  /** Channel'ın döndüğü kimlik (örn. Telegram message_id) */
  messageId?: string;
}

// ═══════════════ CHANNEL INTERFACE ═══════════════

export interface NotifyChannel {
  readonly name: ChannelName;

  /** Channel dolu mu yoksa iskelet mi? */
  readonly isImplemented: boolean;

  /** Config tamam mı (.env.local doldurulmuş mu)? */
  isConfigured(): boolean;

  /** Mesaj gönder */
  send(msg: NotifyMessage): Promise<NotifyResult>;
}

// ═══════════════ CONFIG ═══════════════

export interface BaseChannelConfig {
  fetchFn?: typeof fetch;
}

// ═══════════════ HELPER ═══════════════

/**
 * "Not implemented" sonucu — iskelet channel'lar için.
 */
export function notImplementedResult(channel: ChannelName): NotifyResult {
  return {
    ok: false,
    channel,
    errorMessage: `${channel} channel not implemented yet`,
  };
}

/**
 * "Not configured" sonucu — channel var ama config eksik.
 */
export function notConfiguredResult(channel: ChannelName): NotifyResult {
  return {
    ok: false,
    channel,
    errorMessage: `${channel} channel not configured (check .env.local)`,
  };
}
