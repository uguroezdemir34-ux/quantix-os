/**
 * TELEGRAM CHANNEL — NotifyChannel impl.
 *
 * Orchestrator katmanı bu class'ı kullanır. İçinde:
 *   1. Config oku (env'den)
 *   2. NotifyMessage'i Markdown V2 string'e çevir
 *   3. HTTP client ile gönder
 *   4. Sonucu NotifyResult olarak normalize et
 */

import type {
  NotifyChannel,
  NotifyMessage,
  NotifyResult,
  ChannelName,
  BaseChannelConfig,
} from "@/lib/notify/types";
import { loadTelegramConfigFromEnv, type TelegramConfig } from "./config";
import { formatNotifyMessage } from "./formatter";
import { sendTelegramMessage } from "./client";

export interface TelegramChannelConfig extends BaseChannelConfig {
  /** Test için direct config (env bypass) */
  configOverride?: TelegramConfig | null;
  /** Test için sleep override */
  sleepFn?: (ms: number) => Promise<void>;
}

export class TelegramChannel implements NotifyChannel {
  readonly name: ChannelName = "telegram";
  readonly isImplemented = true;
  private readonly config: TelegramConfig | null;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn?: (ms: number) => Promise<void>;

  constructor(opts: TelegramChannelConfig = {}) {
    this.config =
      opts.configOverride !== undefined
        ? opts.configOverride
        : loadTelegramConfigFromEnv();
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.sleepFn = opts.sleepFn;
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async send(msg: NotifyMessage): Promise<NotifyResult> {
    if (!this.config) {
      return {
        ok: false,
        channel: this.name,
        errorMessage: "Telegram channel not configured (check .env.local)",
      };
    }

    let text: string;
    try {
      text = formatNotifyMessage(msg);
    } catch (e) {
      return {
        ok: false,
        channel: this.name,
        errorMessage: `Format error: ${e instanceof Error ? e.message : "Unknown"}`,
      };
    }

    const r = await sendTelegramMessage(
      this.config,
      { text },
      { fetchFn: this.fetchFn, sleepFn: this.sleepFn },
    );

    if (r.ok) {
      return {
        ok: true,
        channel: this.name,
        messageId: r.messageId,
      };
    }
    return {
      ok: false,
      channel: this.name,
      errorMessage: `${r.errorKind ?? "unknown"}: ${r.errorMessage ?? ""} (${r.attempts} attempts)`,
    };
  }
}
