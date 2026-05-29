/**
 * SECURE STORAGE — AES-256-GCM şifreli localStorage katmanı.
 *
 * Tehdit modeli:
 *   - localStorage düz metin olarak saklanır → XSS, tarayıcı senkronizasyonu,
 *     disk forensiği veya uzantılar bu veriyi okuyabilir.
 *   - Bu katman bakiye, trade geçmişi ve risk state'ini şifreli yazar.
 *
 * Şifreleme stratejisi:
 *   AES-256-GCM (AEAD) — kimlik doğrulamalı şifreleme.
 *   Her write için 96-bit rastgele IV üretilir → replay / IV-reuse saldırısı yok.
 *
 * Anahtar yönetimi:
 *   1. İlk yükleme: `crypto.subtle.generateKey` ile AES-256-GCM key üretilir.
 *   2. Anahtar bellekte tutulur (module singleton).
 *   3. Tarayıcıda: JWK olarak sessionStorage'a yazılır — sayfa yenileme sonrası
 *      aynı tab veriyi çözebilir, tab kapatılınca anahtar ölür.
 *   4. Node.js (test): sessionStorage yok, key sadece bellekte yaşar.
 *
 * Depolama formatı:
 *   localStorage değeri: "ENC1:<base64(IV + ciphertext)>"
 *   "ENC1:" prefiksi: sürüm marker, şifreli veri ile düz JSON'ı ayırt eder.
 *
 * Graceful recovery:
 *   Şifre çözme herhangi bir sebeple başarısız olursa (yanlış key, bozuk veri,
 *   eski format) → localStorage kaydı silinir, `defaultValue` döner.
 *   Sistem çökmez.
 *
 * Saf olmayan fonksiyonlar: localStorage/sessionStorage/crypto erişir.
 * Test enjeksiyonu: `cryptoKey` parametresi ile DI sağlanır.
 */

import type { z } from "zod";
import { STORAGE_PREFIX, isStorageAvailable } from "./persist";

// ─── Sabitler ────────────────────────────────────────────────

/** localStorage değerinin başındaki sürüm markeri */
export const ENC_PREFIX = "ENC1:";

/** sessionStorage'da anahtar saklama key'i */
const SESSION_KEY_NAME = "ug52_sk";

/** AES-GCM IV boyutu (byte) */
const IV_LENGTH = 12;

// ─── Singleton key (bellek içi) ───────────────────────────────

let _cachedKey: CryptoKey | null = null;

// ─── Web Crypto erişimi ───────────────────────────────────────

/**
 * Ortama göre Web Crypto API referansı döner.
 * Browser: window.crypto, Node.js 18+: globalThis.crypto.
 */
function getCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API kullanılamıyor.");
}

// ─── sessionStorage (browser only) ───────────────────────────

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Private mod veya SSR
  }
  return null;
}

// ─── Yardımcı: Base64 ↔ ArrayBuffer ──────────────────────────

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ─── Anahtar üretimi / yükleme ────────────────────────────────

/**
 * Yeni AES-256-GCM anahtarı üret.
 * extractable=true: JWK formatına dönüştürüp sessionStorage'a kaydedebilmek için.
 */
export async function generateSessionKey(): Promise<CryptoKey> {
  return getCrypto().subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable — JWK export için
    ["encrypt", "decrypt"],
  );
}

/**
 * CryptoKey → JWK base64 string (sessionStorage için).
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const jwk = await getCrypto().subtle.exportKey("jwk", key);
  return btoa(JSON.stringify(jwk));
}

/**
 * JWK base64 string → CryptoKey.
 */
export async function importKey(encoded: string): Promise<CryptoKey> {
  const jwk = JSON.parse(atob(encoded)) as JsonWebKey;
  return getCrypto().subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Session anahtarını döndür veya oluştur.
 *
 * Öncelik sırası:
 *   1. Bellek cache (_cachedKey)
 *   2. sessionStorage'dan yükle (aynı tab, sayfa yenileme)
 *   3. Yeni üret + sessionStorage'a kaydet
 *
 * DI: `_keyOverride` sadece testlerde kullanılır.
 */
export async function getOrCreateSessionKey(
  _keyOverride?: CryptoKey,
): Promise<CryptoKey> {
  if (_keyOverride) return _keyOverride;
  if (_cachedKey) return _cachedKey;

  // Browser: sessionStorage'dan yükle
  const ss = getSessionStorage();
  if (ss) {
    try {
      const stored = ss.getItem(SESSION_KEY_NAME);
      if (stored) {
        const key = await importKey(stored);
        _cachedKey = key;
        return key;
      }
    } catch {
      // Bozuk kayıt — yeni üret
      ss.removeItem(SESSION_KEY_NAME);
    }
  }

  // Yeni üret
  const key = await generateSessionKey();
  _cachedKey = key;

  // Browser: sessionStorage'a kaydet
  if (ss) {
    try {
      ss.setItem(SESSION_KEY_NAME, await exportKey(key));
    } catch {
      // sessionStorage dolu veya erişilemiyor — bellekte devam et
    }
  }

  return key;
}

/**
 * Bellek cache'ini sıfırla (test yardımcısı — anahtar rotasyonu simülasyonu).
 */
export function _resetSessionKeyCache(): void {
  _cachedKey = null;
}

// ─── Şifreleme / Çözme ───────────────────────────────────────

/**
 * Herhangi bir değeri AES-256-GCM ile şifrele.
 *
 * Çıktı: "ENC1:<base64(IV || ciphertext)>"
 * IV: 96-bit rastgele, her çağrıda yeni.
 */
export async function encryptValue(
  key: CryptoKey,
  data: unknown,
): Promise<string> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  // IV + ciphertext birleştir
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  return ENC_PREFIX + bufferToBase64(combined.buffer);
}

/**
 * AES-256-GCM ile şifrelenmiş değeri çöz.
 *
 * Beklenen format: "ENC1:<base64(IV || ciphertext)>"
 * Başarısız olursa Error fırlatır (caller graceful recovery yapmalı).
 */
export async function decryptValue(
  key: CryptoKey,
  encoded: string,
): Promise<unknown> {
  if (!encoded.startsWith(ENC_PREFIX)) {
    throw new Error("Geçersiz şifreli veri formatı: ENC1 prefiksi yok.");
  }

  const b64 = encoded.slice(ENC_PREFIX.length);
  const combined = new Uint8Array(base64ToBuffer(b64));

  if (combined.length <= IV_LENGTH) {
    throw new Error("Şifreli veri çok kısa: IV + ciphertext bekleniyor.");
  }

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

// ─── Güvenli localStorage okuma / yazma ──────────────────────

/**
 * localStorage'dan şifreli değer oku ve çöz.
 *
 * Graceful recovery garantisi:
 *   - Şifre çözme hatası → localStorage kaydı silinir, defaultValue döner
 *   - Yanlış anahtar (key rotation sonrası) → aynı şekilde recover
 *   - Bozuk base64 / truncated → aynı şekilde recover
 *
 * @param key       localStorage key (STORAGE_PREFIX otomatik eklenir)
 * @param defaultValue  Hata durumunda dönen değer
 * @param opts.schema   Zod schema (isteğe bağlı — parse sonrası validate)
 * @param opts.cryptoKey  DI (test için override)
 */
export async function loadSecure<T>(
  key: string,
  defaultValue: T,
  opts: { schema?: z.ZodType<T>; cryptoKey?: CryptoKey } = {},
): Promise<T> {
  if (!isStorageAvailable()) return defaultValue;
  const fullKey = STORAGE_PREFIX + key;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(fullKey);
  } catch {
    return defaultValue;
  }

  if (raw === null) return defaultValue;

  // Düz JSON (şifresiz eski format) → schema ile parse edip döndür
  if (!raw.startsWith(ENC_PREFIX)) {
    try {
      const parsed = JSON.parse(raw);
      if (opts.schema) {
        const result = opts.schema.safeParse(parsed);
        return result.success ? result.data : defaultValue;
      }
      return parsed as T;
    } catch {
      return defaultValue;
    }
  }

  // Şifreli format → çöz
  try {
    const cryptoKey =
      opts.cryptoKey ?? (await getOrCreateSessionKey());
    const decrypted = await decryptValue(cryptoKey, raw);

    if (opts.schema) {
      const result = opts.schema.safeParse(decrypted);
      if (!result.success) {
        window.localStorage.removeItem(fullKey);
        return defaultValue;
      }
      return result.data;
    }

    return decrypted as T;
  } catch {
    // Anahtar uyumsuzluğu, bozuk veri — sil ve default'a dön
    try {
      window.localStorage.removeItem(fullKey);
    } catch {
      // Silme de başarısız olabilir (storage erişim hatası)
    }
    return defaultValue;
  }
}

/**
 * localStorage'a şifreli değer yaz.
 *
 * @returns true → başarılı, false → SSR / quota dolu / şifreleme hatası
 */
export async function saveSecure<T>(
  key: string,
  value: T,
  opts: { cryptoKey?: CryptoKey } = {},
): Promise<boolean> {
  if (!isStorageAvailable()) return false;
  const fullKey = STORAGE_PREFIX + key;

  try {
    const cryptoKey = opts.cryptoKey ?? (await getOrCreateSessionKey());
    const encrypted = await encryptValue(cryptoKey, value);
    window.localStorage.setItem(fullKey, encrypted);
    return true;
  } catch {
    return false;
  }
}

// ─── Veri tipi: şifreli mi? ───────────────────────────────────

/**
 * Belirli bir localStorage key'inin şifreli formatda saklandığını kontrol et.
 * UI ve migrasyon için yardımcı.
 */
export function isEncrypted(key: string): boolean {
  if (!isStorageAvailable()) return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    return raw !== null && raw.startsWith(ENC_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Düz JSON'dan şifreli formata tek seferlik migrasyon.
 *
 * Mevcut veriyi okur (düz JSON), şifreli olarak yeniden yazar.
 * Zaten şifreliyse no-op.
 *
 * @returns "migrated" | "already_encrypted" | "no_data" | "error"
 */
export async function migrateToEncrypted(
  key: string,
  opts: { cryptoKey?: CryptoKey } = {},
): Promise<"migrated" | "already_encrypted" | "no_data" | "error"> {
  if (!isStorageAvailable()) return "error";
  const fullKey = STORAGE_PREFIX + key;

  try {
    const raw = window.localStorage.getItem(fullKey);
    if (raw === null) return "no_data";
    if (raw.startsWith(ENC_PREFIX)) return "already_encrypted";

    const parsed = JSON.parse(raw);
    const cryptoKey = opts.cryptoKey ?? (await getOrCreateSessionKey());
    const encrypted = await encryptValue(cryptoKey, parsed);
    window.localStorage.setItem(fullKey, encrypted);
    return "migrated";
  } catch {
    return "error";
  }
}
