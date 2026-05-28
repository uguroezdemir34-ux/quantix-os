/**
 * OKX CONFIG CHECK ENDPOINT — Ayarlar sayfası için.
 *
 * GET /api/okx/check
 *
 * Server-side: .env'den OKX creds'i kontrol et, sadece DURUMU döner.
 * Asla gerçek key/secret/pass'i istemciye GÖNDERMEZ.
 *
 * Response shape:
 *   { prodConfigured: boolean, demoConfigured: boolean }
 *
 * UI bu endpoint'i sadece bağlantı durumunu göstermek için kullanır.
 * Gerçek creds yönetimi `.env.local` dosyasında — bu doğru güvenlik pratiği.
 */

import { loadServerConfigFromEnv } from "@/lib/okx/server-handler";

export async function GET(): Promise<Response> {
  const config = loadServerConfigFromEnv(process.env);

  return Response.json({
    prodConfigured: config.prodCreds !== null,
    demoConfigured: config.demoCreds !== null,
  });
}
