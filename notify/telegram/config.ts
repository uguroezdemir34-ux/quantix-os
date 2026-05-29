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
  env: NodeJS.ProcessEnv = process.env,
): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_VIP_CHAT_ID;

  if (!botToken || !chatId) return null;
  if (botToken.trim() === "" || chatId.trim() === "") return null;

  // Bot token format kontrolü — kabaca "<digits>:<token>"
  // Telegram bot token formatı: "<bot_id>:<35-char base64>"
  // Sıkı validation yapmıyoruz (BotFather formatı değişebilir), sadece ":" var mı
  if (!botToken.includes(":")) return null;

  return {
    botToken: botToken.trim(),
    chatId: chatId.trim(),
  };
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
