/**
 * TELEGRAM CONFIG — Bot token + chat ID okuma.
 *
 * Tüm bilgi server-side environment'tan gelir (`.env.local`).
 * Asla client bundle'ına girmez.
 */

export interface TelegramConfig {
  /** Bot token — BotFather'dan alınır, format: "<digits>:<base64ish>" */
  botToken: string;
  /** VIP grup veya kanal ID — sayı (grup için "-100..." formatlı) */
  chatId: string;
}

/**
 * Env'den config oku — eksikse null döner (channel "not configured").
 *
 * Test'te `env` parametresi inject edilir (process.env mock).
 */
export function loadTelegramConfigFromEnv(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {}),
): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_VIP_CHAT_ID?.trim();

  if (!botToken || !chatId) {
    if (typeof console !== "undefined") {
      console.warn("[QUANTIX ENV] ⚠️  TELEGRAM_BOT_TOKEN veya TELEGRAM_VIP_CHAT_ID eksik — bildirimler devre dışı.");
    }
    return null;
  }
  if (!botToken.includes(":")) {
    if (typeof console !== "undefined") {
      console.warn("[QUANTIX ENV] ⚠️  TELEGRAM_BOT_TOKEN formatı geçersiz (beklenen: '<id>:<token>').");
    }
    return null;
  }

  return { botToken, chatId };
}

/**
 * Config tam doğruluk kontrolü.
 * Network'e bağlanmaz, sadece syntax kontrolü.
 */
export function isValidTelegramConfig(config: TelegramConfig | null): boolean {
  if (!config) return false;
  if (!config.botToken || !config.chatId) return false;
  if (!config.botToken.includes(":")) return false;
  return true;
}
