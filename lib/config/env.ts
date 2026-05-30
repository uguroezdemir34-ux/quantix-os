/**
 * QUANTIX OS — Merkezi Ortam Konfigürasyonu
 *
 * Tüm process.env erişimi buradan yapılır.
 * Modüller bu dosyayı import eder, process.env'i doğrudan okumaz.
 *
 * Fail-Safe Davranış:
 *   - Eksik zorunlu değişken → sistem çökmez, null döner + konsola uyarı yazar.
 *   - Eksik opsiyonel değişken → sessizce varsayılan kullanır.
 *   - validate() → başlangıçta bir kez çağrılır, eksiklikleri özetler.
 *
 * Kural:
 *   Bu dosya YALNIZCA server-side'da çalışır (process.env gizli değerleri).
 *   NEXT_PUBLIC_* değişkenleri hem client hem server'da güvenlidir.
 */

// ─── Tipler ──────────────────────────────────────────────────

export type ExecutionMode = "SHADOW" | "LIVE";

export interface OkxCredentialSet {
  key: string;
  secret: string;
  passphrase: string;
}

export interface OkxEnvConfig {
  /** Canlı hesap credentials — LIVE modunda kullanılır */
  live: OkxCredentialSet | null;
  /** Demo hesap credentials — SHADOW modunda kullanılır */
  demo: OkxCredentialSet | null;
}

export interface TelegramEnvConfig {
  botToken: string;
  chatId: string;
}

export interface QuantixEnvConfig {
  /** Uygulama URL'i (Vercel'de otomatik, lokalde localhost:3000) */
  appUrl: string;
  /** İşlem modu */
  executionMode: ExecutionMode;
  /** OKX API credentials */
  okx: OkxEnvConfig;
  /** Telegram bildirim hattı — null ise bildirimler devre dışı */
  telegram: TelegramEnvConfig | null;
  /** STATE şifreleme anahtarı — null ise şifreleme browser-key moduna düşer */
  stateEncryptionKey: string | null;
  /** OKX WebSocket enstrüman listesi */
  okxInstruments: string[];
  /** OKX WebSocket ping aralığı (ms) */
  okxPingIntervalMs: number;
}

/** Konfigürasyon doğrulama sonucu */
export interface EnvValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
  /** Aktif mod için gerekli credentials mevcut mu? */
  credentialsReady: boolean;
}

// ─── Sabitler ────────────────────────────────────────────────

const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_PING_INTERVAL_MS = 25_000;
const DEFAULT_INSTRUMENTS = ["BTC-USDT-SWAP", "ETH-USDT-SWAP"];

// ─── Yardımcılar ─────────────────────────────────────────────

function str(val: string | undefined): string | null {
  const trimmed = val?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function warn(msg: string): void {
  // Next.js server-side ve Node.js ortamında güvenli
  if (typeof console !== "undefined") {
    console.warn(`[QUANTIX ENV] ⚠️  ${msg}`);
  }
}

// ─── Ana loader ───────────────────────────────────────────────

/**
 * Ortam değişkenlerini oku, yapılandırma nesnesini döndür.
 * Eksik değişkenler için console.warn yazar, çökmez.
 *
 * @param env  Ortam kaynağı (test inject için — varsayılan: process.env)
 */
export function loadEnvConfig(
  env: Record<string, string | undefined> = process.env,
): QuantixEnvConfig {
  // — Uygulama URL
  const appUrl = str(env.NEXT_PUBLIC_APP_URL) ?? DEFAULT_APP_URL;

  // — Execution Mode
  const rawMode = str(env.EXECUTION_MODE)?.toUpperCase();
  let executionMode: ExecutionMode = "SHADOW";
  if (rawMode === "LIVE") {
    executionMode = "LIVE";
  } else if (rawMode && rawMode !== "SHADOW") {
    warn(`EXECUTION_MODE="${rawMode}" tanınmıyor — SHADOW moduna düşüldü.`);
  }

  // — OKX Live credentials
  const liveKey = str(env.OKX_API_KEY);
  const liveSecret = str(env.OKX_API_SECRET);
  const livePass = str(env.OKX_API_PASSPHRASE);
  const liveOk = liveKey && liveSecret && livePass;
  if (!liveOk && executionMode === "LIVE") {
    warn(
      "LIVE mod seçildi ancak OKX_API_KEY / OKX_API_SECRET / OKX_API_PASSPHRASE eksik. " +
        "Canlı işlemler çalışmayacak.",
    );
  }

  // — OKX Demo credentials
  const demoKey = str(env.OKX_DEMO_API_KEY);
  const demoSecret = str(env.OKX_DEMO_API_SECRET);
  const demoPass = str(env.OKX_DEMO_API_PASSPHRASE);
  const demoOk = demoKey && demoSecret && demoPass;
  if (!demoOk && executionMode === "SHADOW") {
    warn(
      "SHADOW mod seçildi ancak OKX_DEMO_API_KEY / OKX_DEMO_API_SECRET / OKX_DEMO_API_PASSPHRASE " +
        "eksik. Shadow işlemler çalışmayacak.",
    );
  }

  // — Telegram
  const botToken = str(env.TELEGRAM_BOT_TOKEN);
  const chatId = str(env.TELEGRAM_VIP_CHAT_ID);
  let telegram: TelegramEnvConfig | null = null;
  if (botToken && chatId) {
    if (!botToken.includes(":")) {
      warn("TELEGRAM_BOT_TOKEN formatı geçersiz (beklenen: '<id>:<token>').");
    } else {
      telegram = { botToken, chatId };
    }
  } else {
    warn(
      "TELEGRAM_BOT_TOKEN veya TELEGRAM_VIP_CHAT_ID eksik — " +
        "Telegram bildirimleri devre dışı.",
    );
  }

  // — State Encryption Key
  const stateEncryptionKey = str(env.STATE_ENCRYPTION_KEY);
  if (!stateEncryptionKey) {
    warn(
      "STATE_ENCRYPTION_KEY eksik — localStorage şifrelemesi browser-key " +
        "moduna düşüyor (sekme kapatılınca anahtar kaybolur).",
    );
  }

  // — OKX WebSocket enstrümanlar
  const instrumentsRaw = str(env.OKX_INSTRUMENTS);
  const okxInstruments = instrumentsRaw
    ? instrumentsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_INSTRUMENTS;

  // — Ping interval
  const pingRaw = parseInt(str(env.OKX_PING_INTERVAL_MS) ?? "", 10);
  const okxPingIntervalMs =
    isFinite(pingRaw) && pingRaw > 0 ? pingRaw : DEFAULT_PING_INTERVAL_MS;

  return {
    appUrl,
    executionMode,
    okx: {
      live: liveOk
        ? { key: liveKey!, secret: liveSecret!, passphrase: livePass! }
        : null,
      demo: demoOk
        ? { key: demoKey!, secret: demoSecret!, passphrase: demoPass! }
        : null,
    },
    telegram,
    stateEncryptionKey,
    okxInstruments,
    okxPingIntervalMs,
  };
}

// ─── Validation ───────────────────────────────────────────────

/**
 * Başlangıç doğrulaması — uygulama boot'unda bir kez çağrılır.
 * Eksik/hatalı değişkenleri özetler, sistemi durdurmaz.
 */
export function validateEnvConfig(cfg: QuantixEnvConfig): EnvValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Aktif mod için credentials kontrolü
  const credentialsReady =
    cfg.executionMode === "LIVE"
      ? cfg.okx.live !== null
      : cfg.okx.demo !== null;

  if (!credentialsReady) {
    errors.push(
      `${cfg.executionMode} modu için OKX credentials eksik. İşlem başlatılamaz.`,
    );
  }

  if (!cfg.telegram) {
    warnings.push("Telegram bildirimleri yapılandırılmamış.");
  }

  if (!cfg.stateEncryptionKey) {
    warnings.push("STATE_ENCRYPTION_KEY eksik — oturum şifrelemesi geçici anahtar kullanıyor.");
  }

  if (cfg.appUrl === DEFAULT_APP_URL && cfg.executionMode === "LIVE") {
    warnings.push(
      "NEXT_PUBLIC_APP_URL hâlâ localhost — production deploy'da gerçek URL ayarlayın.",
    );
  }

  const ok = errors.length === 0;

  if (!ok) {
    errors.forEach((e) => console.error(`[QUANTIX ENV] ❌  ${e}`));
  }
  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(`[QUANTIX ENV] ⚠️  ${w}`));
  }
  if (ok && credentialsReady) {
    console.info(
      `[QUANTIX ENV] ✅  Konfigürasyon hazır — mod: ${cfg.executionMode}` +
        (cfg.telegram ? " | Telegram: aktif" : " | Telegram: kapalı"),
    );
  }

  return { ok, warnings, errors, credentialsReady };
}

// ─── OKX server-handler uyumlu adapter ───────────────────────

/**
 * loadServerConfigFromEnv için drop-in adapter.
 * Mevcut okx/server-handler.ts'yi değiştirmeden buradan besler.
 */
export function toOkxServerConfig(cfg: QuantixEnvConfig): {
  prodCreds: { key: string; secret: string; pass: string } | null;
  demoCreds: { key: string; secret: string; pass: string } | null;
} {
  return {
    prodCreds: cfg.okx.live
      ? {
          key: cfg.okx.live.key,
          secret: cfg.okx.live.secret,
          pass: cfg.okx.live.passphrase,
        }
      : null,
    demoCreds: cfg.okx.demo
      ? {
          key: cfg.okx.demo.key,
          secret: cfg.okx.demo.secret,
          pass: cfg.okx.demo.passphrase,
        }
      : null,
  };
}

/**
 * Telegram config adapter — loadTelegramConfigFromEnv drop-in.
 */
export function toTelegramConfig(cfg: QuantixEnvConfig): {
  botToken: string;
  chatId: string;
} | null {
  return cfg.telegram
    ? { botToken: cfg.telegram.botToken, chatId: cfg.telegram.chatId }
    : null;
}

// ─── Singleton (server-side) ──────────────────────────────────

/**
 * Sunucu başlangıcında yüklenen singleton config.
 * Next.js API Route'larında import ederek kullan:
 *   import { serverEnv } from "@/lib/config/env";
 *
 * NOT: Bu nesne module-load zamanında oluşturulur.
 *      Test ortamında doğrudan `loadEnvConfig(mockEnv)` kullan.
 */
export const serverEnv: QuantixEnvConfig =
  typeof process !== "undefined"
    ? loadEnvConfig(process.env as Record<string, string | undefined>)
    : loadEnvConfig({});
