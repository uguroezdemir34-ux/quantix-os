/**
 * STORE — SSR-safe localStorage wrapper.
 * Kaynak: panel_v55_51.html satır 4058-4068 (LS.get/set/del).
 *
 * Panel mantığı:
 *   - LS.get(key, default) → JSON.parse, hata varsa default
 *   - LS.set(key, value)   → JSON.stringify
 *   - LS.del(key)          → removeItem
 *
 * v2'de eklenenler:
 *   - SSR güvenliği: window/localStorage yoksa varsayılan döner (no-op)
 *   - Zod schema validation: bozuk veri varsa silently silinir, default kullanılır
 *   - Tip güvenliği: <T> parametresi ile compile-time tip kontrolü
 *
 * KEY PREFIX: 'ug52_' — panel ile birebir uyum, tüm key'ler bu prefix'le başlar.
 * Bu sayede aynı tarayıcıdaki panel verisi v2 ile **paylaşılabilir** (export/import).
 */

import type { z } from "zod";

/** Tüm v2 storage key'leri 'ug52_' prefix'iyle başlar (panel ile uyumlu) */
export const STORAGE_PREFIX = "ug52_";

/**
 * SSR/CSR güvenli localStorage erişim kontrolü.
 * Server-side render veya jsdom yokken false döner.
 */
export function isStorageAvailable(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (typeof window.localStorage === "undefined") return false;
    // Test write (incognito mod / disk full senaryosu)
    const testKey = "__ug52_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * localStorage'tan oku ve parse et.
 *
 * @param key - 'ug52_' prefix'i olmadan key adı (örn 'lastTab')
 * @param defaultValue - Hata durumunda dönecek değer
 * @param schema - Opsiyonel Zod schema; validate fail → defaultValue
 * @returns Parse edilmiş değer veya defaultValue
 */
export function loadFromStorage<T>(
  key: string,
  defaultValue: T,
  schema?: z.ZodType<T>,
): T {
  if (!isStorageAvailable()) return defaultValue;
  const fullKey = STORAGE_PREFIX + key;

  try {
    const raw = window.localStorage.getItem(fullKey);
    if (raw === null) return defaultValue;
    const parsed = JSON.parse(raw);

    // Schema varsa validate et
    if (schema) {
      const result = schema.safeParse(parsed);
      if (!result.success) {
        // Bozuk veri — sil ve default'a dön
        window.localStorage.removeItem(fullKey);
        return defaultValue;
      }
      return result.data;
    }

    return parsed as T;
  } catch {
    return defaultValue;
  }
}

/**
 * localStorage'a yaz (JSON.stringify).
 *
 * @returns true → başarılı, false → SSR/storage erişilemiyor/quota dolu
 */
export function saveToStorage<T>(key: string, value: T): boolean {
  if (!isStorageAvailable()) return false;
  const fullKey = STORAGE_PREFIX + key;
  try {
    window.localStorage.setItem(fullKey, JSON.stringify(value));
    return true;
  } catch {
    // QuotaExceededError veya serialization error
    return false;
  }
}

/**
 * localStorage'tan sil.
 *
 * @returns true → başarılı, false → SSR/storage erişilemiyor
 */
export function removeFromStorage(key: string): boolean {
  if (!isStorageAvailable()) return false;
  const fullKey = STORAGE_PREFIX + key;
  try {
    window.localStorage.removeItem(fullKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tüm 'ug52_' prefix'li key'leri listele.
 * Export/import için faydalı.
 */
export function listStorageKeys(): string[] {
  if (!isStorageAvailable()) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) {
        // Prefix'i kaldırıp döndür (kullanım kolaylığı için)
        keys.push(k.slice(STORAGE_PREFIX.length));
      }
    }
  } catch {
    return [];
  }
  return keys.sort();
}

/**
 * Tüm 'ug52_' prefix'li key'leri sil.
 * "Verileri sıfırla" özelliği için.
 *
 * @returns Silinen key sayısı
 */
export function clearAllStorage(): number {
  if (!isStorageAvailable()) return 0;
  const keys = listStorageKeys();
  let count = 0;
  for (const k of keys) {
    if (removeFromStorage(k)) count++;
  }
  return count;
}

/**
 * Tüm 'ug52_' verilerini export edilebilir nesne olarak topla.
 * Export → JSON.stringify → kullanıcı pano/dosya
 */
export function exportAllStorage(): Record<string, unknown> {
  if (!isStorageAvailable()) return {};
  const result: Record<string, unknown> = {};
  for (const k of listStorageKeys()) {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + k);
    if (raw !== null) {
      try {
        result[k] = JSON.parse(raw);
      } catch {
        // Bozuk veri, atla
      }
    }
  }
  return result;
}

/**
 * Export edilmiş objeyi geri yükle.
 * Mevcut veriler **silinmez**, üzerine yazılır.
 *
 * @returns Yüklenen key sayısı
 */
export function importStorage(data: Record<string, unknown>): number {
  if (!isStorageAvailable()) return 0;
  if (!data || typeof data !== "object") return 0;
  let count = 0;
  for (const [k, v] of Object.entries(data)) {
    if (saveToStorage(k, v)) count++;
  }
  return count;
}
