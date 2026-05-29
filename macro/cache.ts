/**
 * MACRO — In-memory TTL cache.
 *
 * F&G günde 1 değişir, dominance dakikalar mertebesinde. Panel'de cache
 * yoktu (her renderMarketView'da fetch); v2'de server-side route ortak
 * cache kullanır — birden fazla scan döngüsü aynı API'yi spam'lemez.
 *
 * Cache scope: module-level Map. Next.js'in server runtime'ında her
 * pod/serverless invocation içinde kalıcı; cold start sonrası temizlenir,
 * bu kabul edilebilir (fetch fallback'i var).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Cache'ten oku — süresi dolmuşsa null.
 */
export function cacheGet<T>(key: string, now: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

/**
 * Cache'e yaz.
 */
export function cacheSet<T>(
  key: string,
  value: T,
  now: number,
  ttlMs: number,
): void {
  cache.set(key, { value, expiresAt: now + ttlMs });
}

/**
 * Cache'i temizle (test için).
 */
export function cacheClear(): void {
  cache.clear();
}

/**
 * Aktif cache boyutu (test/debug için).
 */
export function cacheSize(): number {
  return cache.size;
}
