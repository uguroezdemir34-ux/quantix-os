/**
 * OKX V5 AUTH — HMAC SHA256 imza üretimi.
 *
 * Panel referansı: panel_v55_51.html satır 4072-4078.
 *
 * OKX V5 imza spec:
 *   prehash = timestamp + method + requestPath + body
 *   signature = Base64(HMAC-SHA256(secret, prehash))
 *   timestamp ISO 8601 UTC (örn: 2026-05-18T10:30:00.000Z)
 *
 * GÜVENLİK NOTU: Bu modül SADECE server-side'da kullanılır
 * (app/api/okx/* route'larında). Browser'da import EDİLMEMELİ — secret
 * sızıntısı riski. `client.ts` tarafı sadece kendi server proxy'sine istek
 * atar, secret'a hiç dokunmaz.
 *
 * Node.js: globalThis.crypto.subtle Web Crypto API olarak mevcut (Node 18+).
 * Panel kodunda window.crypto.subtle aynı API.
 */

export interface OkxCredentials {
  key: string;
  secret: string;
  pass: string;
}

export type OkxMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * HMAC-SHA256 ile imza üret, Base64'e kodla.
 *
 * Panel kodu (satır 4072-4078) ile birebir aynı algoritma.
 * `btoa(String.fromCharCode(...new Uint8Array(sig)))` browser idiom'u —
 * Node'da `Buffer.from(sig).toString('base64')` daha doğal ama her ikisi de
 * aynı çıktıyı verir (testlerle kanıtlandı).
 */
export async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  // Browser-compatible base64 (panel kodu ile birebir)
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * OKX prehash string oluştur. Spec:
 *   GET    → ts + method + path  (body yok)
 *   POST   → ts + method + path + JSON.stringify(body)
 *
 * Önemli: GET'te query string `path`'in parçası olmalı. Body GET için yok sayılır.
 * Panel satır 4092 (GET) ve 4128 (POST) ile uyumlu.
 */
export function buildPrehash(
  timestamp: string,
  method: OkxMethod,
  path: string,
  body?: string,
): string {
  if (method === "GET") {
    return timestamp + method + path;
  }
  return timestamp + method + path + (body ?? "");
}

/**
 * ISO 8601 timestamp, milisaniye hassasiyetli, UTC.
 * Panel `new Date().toISOString()` ile aynı format.
 * Test edilebilirlik için zaman parametre olarak verilebilir.
 */
export function isoTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

/**
 * Bir OKX isteği için tüm imzalı header'ları üret.
 *
 * @param creds API key, secret, passphrase
 * @param method HTTP metodu
 * @param path /api/v5/... ile başlayan path (query string dahil)
 * @param body POST/PUT için JSON-stringified body (GET için undefined)
 * @param isDemo true ise x-simulated-trading: 1 eklenir
 * @param now Test edilebilirlik için override
 */
export async function buildOkxHeaders(
  creds: OkxCredentials,
  method: OkxMethod,
  path: string,
  body: string | undefined,
  isDemo: boolean,
  now: Date = new Date(),
): Promise<Record<string, string>> {
  const ts = isoTimestamp(now);
  const prehash = buildPrehash(ts, method, path, body);
  const sig = await hmacSign(creds.secret, prehash);
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": creds.key,
    "OK-ACCESS-SIGN": sig,
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": creds.pass,
    "Content-Type": "application/json",
  };
  if (isDemo) {
    headers["x-simulated-trading"] = "1";
  }
  return headers;
}
