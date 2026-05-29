/**
 * TELEGRAM HTTP CLIENT — Bot API'ye sendMessage POST.
 *
 * Sorumluluklar:
 *   - HTTP POST `/bot<TOKEN>/sendMessage`
 *   - Markdown V2 parse mode
 *   - Rate limit (429) handling: Retry-After header oku, bekle, dene
 *   - Geçici hata (502/503/504) için exponential backoff (max 3 deneme)
 *   - Bot-spesifik hatalar (401/403/400) için retry YAPMAZ
 *   - Timeout (default 8s) — askıda kalmasın
 *
 * Asla:
 *   - Bot token loglanmaz
 *   - Hata mesajına chat ID veya token detayı sızmaz
 */

import type { TelegramConfig } from "./config";

export interface SendMessageInput {
  text: string; // Markdown V2 formatlı
  /** Notification suppress (true → sessiz bildirim) */
  disableNotification?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  /** Telegram'ın döndüğü message_id (success durumunda) */
  messageId?: string;
  /** Hata tipi (audit için) */
  errorKind?: TelegramErrorKind;
  /** Telegram'dan gelen ham hata mesajı (debug için) */
  errorMessage?: string;
  /** Kaç kez denendi (retry telemetry) */
  attempts: number;
}

export type TelegramErrorKind =
  | "invalid_token" // 401
  | "bot_blocked" // 403 — bot grup'tan atıldı
  | "chat_not_found" // 400 — chat ID yanlış
  | "parse_error" // 400 — Markdown V2 hatası
  | "rate_limited" // 429 — exceeded, max retry sonrası
  | "server_error" // 502/503/504 — Telegram tarafı
  | "network_error" // fetch fail
  | "timeout"
  | "unknown";

export interface ClientOptions {
  fetchFn?: typeof fetch;
  /** Toplam max deneme (default 3) */
  maxAttempts?: number;
  /** Tek istek timeout ms (default 8000) */
  timeoutMs?: number;
  /** Backoff base ms (default 500 — denemeler: 500, 1000, 2000) */
  backoffBaseMs?: number;
  /** Şu an (test injection) */
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = "https://api.telegram.org";

/**
 * Mesaj gönder — retry + rate limit aware.
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  input: SendMessageInput,
  opts: ClientOptions = {},
): Promise<SendMessageResult> {
  const fetchImpl = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const backoffBaseMs = opts.backoffBaseMs ?? 500;
  const sleep = opts.sleepFn ?? defaultSleep;

  const url = `${DEFAULT_BASE_URL}/bot${config.botToken}/sendMessage`;
  const body = {
    chat_id: config.chatId,
    text: input.text,
    parse_mode: "MarkdownV2",
    disable_notification: input.disableNotification ?? false,
  };

  let lastError: Pick<SendMessageResult, "errorKind" | "errorMessage"> = {
    errorKind: "unknown",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      // Hızlı yol: success
      if (res.ok) {
        const data = (await res.json()) as TelegramResponse;
        if (data.ok && data.result) {
          return {
            ok: true,
            messageId: String(data.result.message_id ?? ""),
            attempts: attempt,
          };
        }
        // Telegram body'de ok=false (rare but possible)
        lastError = {
          errorKind: classifyTelegramError(undefined, data.description),
          errorMessage: data.description,
        };
        // Telegram body hatası retryable değil (parse error vs.)
        return { ok: false, ...lastError, attempts: attempt };
      }

      // HTTP error
      const errorBody = await safeReadJson(res);
      const description = errorBody?.description;
      const errorKind = classifyTelegramError(res.status, description);
      lastError = { errorKind, errorMessage: description };

      // Retryable mi?
      if (errorKind === "rate_limited" && attempt < maxAttempts) {
        // Telegram 429'da retry_after gönderir (saniye cinsinden)
        const retryAfterSec = errorBody?.parameters?.retry_after ?? 1;
        await sleep(Math.min(retryAfterSec * 1000, 10000));
        continue;
      }
      if (errorKind === "server_error" && attempt < maxAttempts) {
        // Exponential backoff
        await sleep(backoffBaseMs * Math.pow(2, attempt - 1));
        continue;
      }

      // Retry yok — bot config hatası
      return { ok: false, ...lastError, attempts: attempt };
    } catch (e) {
      clearTimeout(tid);
      const err = e as { name?: string; message?: string };
      const isAbort = err.name === "AbortError";
      lastError = {
        errorKind: isAbort ? "timeout" : "network_error",
        errorMessage: err.message ?? "Unknown",
      };
      // Network error retryable
      if (attempt < maxAttempts) {
        await sleep(backoffBaseMs * Math.pow(2, attempt - 1));
        continue;
      }
      return { ok: false, ...lastError, attempts: attempt };
    }
  }

  // Buraya düşmemeli, ama TS için
  return { ok: false, ...lastError, attempts: maxAttempts };
}

// ═══════════════ HELPERS ═══════════════

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: { message_id?: number };
  parameters?: { retry_after?: number };
}

function classifyTelegramError(
  httpStatus: number | undefined,
  description: string | undefined,
): TelegramErrorKind {
  if (httpStatus === 401) return "invalid_token";
  if (httpStatus === 403) return "bot_blocked";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504)
    return "server_error";

  if (httpStatus === 400) {
    const d = (description ?? "").toLowerCase();
    if (d.includes("chat not found")) return "chat_not_found";
    if (d.includes("parse") || d.includes("entities") || d.includes("entity"))
      return "parse_error";
    return "unknown";
  }
  return "unknown";
}

async function safeReadJson(
  res: Response,
): Promise<TelegramResponse | null> {
  try {
    return (await res.json()) as TelegramResponse;
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
