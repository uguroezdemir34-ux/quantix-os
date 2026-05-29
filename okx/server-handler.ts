/**
 * OKX SERVER-SIDE PROXY HANDLER
 *
 * Bu modül `app/api/okx/[...path]/route.ts`'ten çağrılır.
 * Route handler ile aynı dosyada olursa Next.js Route'larını mock etmek
 * gerekirdi — burada saf fonksiyon olarak ayırdık, Vitest ile bağımsız test
 * edilebilir.
 *
 * GÜVENLİK MİMARİSİ:
 *   Browser  →  /api/okx/<path>     (cookie/session ile auth, secret YOK)
 *   Server   →  buildOkxHeaders     (secret env'den okunur, imza burada)
 *   Server   →  https://www.okx.com/<path>
 *   Server   →  Zod validate        (yanıt bozuksa client'a hata)
 *   Browser  ←  ParsedOkxResponse
 *
 * Secret browser bundle'ına ASLA girmez. Test ediyoruz (paket #3 doğrulama).
 */

import {
  buildOkxHeaders,
  type OkxCredentials,
  type OkxMethod,
} from "./auth";
import { parseOkxEnvelope, type ParsedOkxResponse } from "./schemas";

/**
 * Public endpoint prefix'leri — auth gerekmez, header imzalama atlanır.
 *
 * OKX dokümantasyonu: market/public endpoints public, hesap/işlem private.
 * Bizim ihtiyacımız: mum verileri (market/candles), ticker, instrument bilgisi.
 *
 * Sources:
 *   - https://www.okx.com/docs-v5/en/#public-data-rest-api
 *   - panel_v55_51.html satır 4612 ("public endpoints, no signing")
 */
const PUBLIC_PATH_PREFIXES: readonly string[] = [
  "/api/v5/market/",
  "/api/v5/public/",
];

function isPublicOkxPath(path: string): boolean {
  // Query string'i ayır (path?.includes değil — prefix kontrolü)
  const cleanPath = path.split("?")[0];
  return PUBLIC_PATH_PREFIXES.some((prefix) => cleanPath.startsWith(prefix));
}

// Test edilebilirlik için export
export { isPublicOkxPath, PUBLIC_PATH_PREFIXES };

/**
 * Server tarafının ihtiyaç duyduğu env değişkenleri.
 * Production'da process.env'den okunur, testte mock geçilir.
 */
export interface OkxServerConfig {
  prodCreds: OkxCredentials | null;
  demoCreds: OkxCredentials | null;
  baseUrl?: string; // varsayılan https://www.okx.com
  timeoutMs?: number; // varsayılan 8000 (panel ile aynı)
}

/**
 * Client'tan gelen isteğin parse edilmiş hali.
 */
export interface OkxProxyRequest {
  method: OkxMethod;
  path: string; // /api/v5/... ile başlayan
  body?: unknown; // POST için JSON gövdesi (object)
  isDemo: boolean;
}

/**
 * Test edilebilirlik için fetch interface (Node fetch veya mock).
 */
export type FetchFn = typeof fetch;

/**
 * Server-side OKX proxy çağrısı.
 *
 * @param req Client'tan gelen istek
 * @param config Server env config (creds + baseUrl)
 * @param fetchImpl Override için (testte mock geçilir)
 * @param now Test için zaman override
 */
export async function handleOkxProxy(
  req: OkxProxyRequest,
  config: OkxServerConfig,
  fetchImpl: FetchFn = fetch,
  now: Date = new Date(),
): Promise<ParsedOkxResponse> {
  // 1. Path güvenlik kontrolü — sadece /api/v5/* yollarına izin
  if (!req.path.startsWith("/api/v5/")) {
    return { ok: false, err: "INVALID_PATH" };
  }

  // 2. Public endpoint kontrolü — auth bypass
  const isPublic = isPublicOkxPath(req.path);

  // 3. Private endpoint: doğru credential setini seç
  let creds: OkxCredentials | null = null;
  if (!isPublic) {
    creds = req.isDemo ? config.demoCreds : config.prodCreds;
    if (!creds || !creds.key || !creds.secret || !creds.pass) {
      return {
        ok: false,
        err: req.isDemo ? "NO_DEMO_KEYS" : "NO_KEYS",
      };
    }
  }

  // 4. Body'yi stringle (POST için)
  const bodyStr =
    req.method === "GET" || req.body === undefined
      ? undefined
      : JSON.stringify(req.body);

  // 5. Header'ları üret — public ise sadece Content-Type, private ise imzalı
  let headers: Record<string, string>;
  if (isPublic) {
    headers = {
      "Content-Type": "application/json",
    };
  } else {
    // creds yukarıda zorunlu olarak set edildi
    headers = await buildOkxHeaders(
      creds!,
      req.method,
      req.path,
      bodyStr,
      req.isDemo,
      now,
    );
  }

  // 6. Timeout ile fetch
  const baseUrl = config.baseUrl ?? "https://www.okx.com";
  const timeoutMs = config.timeoutMs ?? 8000;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(baseUrl + req.path, {
      method: req.method,
      headers,
      body: bodyStr,
      signal: ctrl.signal,
    });
    const raw = await res.json();
    return parseOkxEnvelope(raw);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return {
      ok: false,
      err: err.name === "AbortError" ? "TIMEOUT_8s" : err.message ?? "UNKNOWN",
    };
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Production'da env'den config yükle.
 * .env.local'da `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` + demo versiyonu.
 *
 * Eksik creds → null döner (proxy çağrıldığında NO_KEYS hatası verir,
 * çökme yok — bu davranış panel ile uyumlu).
 */
export function loadServerConfigFromEnv(env: NodeJS.ProcessEnv): OkxServerConfig {
  const prodOk =
    !!env.OKX_API_KEY && !!env.OKX_API_SECRET && !!env.OKX_API_PASSPHRASE;
  const demoOk =
    !!env.OKX_DEMO_API_KEY &&
    !!env.OKX_DEMO_API_SECRET &&
    !!env.OKX_DEMO_API_PASSPHRASE;

  return {
    prodCreds: prodOk
      ? {
          key: env.OKX_API_KEY!,
          secret: env.OKX_API_SECRET!,
          pass: env.OKX_API_PASSPHRASE!,
        }
      : null,
    demoCreds: demoOk
      ? {
          key: env.OKX_DEMO_API_KEY!,
          secret: env.OKX_DEMO_API_SECRET!,
          pass: env.OKX_DEMO_API_PASSPHRASE!,
        }
      : null,
  };
}
