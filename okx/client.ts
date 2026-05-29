/**
 * OKX CLIENT (BROWSER-SIDE)
 *
 * Bu modül browser'da çalışır. SECRET'a DOKUNMAZ — sadece kendi server
 * proxy'mize istek atar (`/api/okx/...`), server tarafı imzalayıp OKX'e
 * gönderir.
 *
 * Faz 1b paket #2'deki `TrailingManager.deps.cancelAlgoOrders` ve
 * `closePosition` bağımlılıkları buradan implement edilecek.
 *
 * Panel paralel: `okxFetch`/`okxPost` ile aynı imza, ama gerçek HTTP yapısı
 * farklı (browser → kendi server → OKX, eskisi browser → OKX direkt).
 */

import type { ParsedOkxResponse } from "./schemas";
import type { OkxMethod } from "./auth";

export interface OkxClientOptions {
  /**
   * Demo mode okuyucu — runtime'da TrailingManager.deps.isDemoMode ile
   * aynı kaynaktan beslenir.
   */
  isDemoMode: () => boolean;
  /** Test override için */
  fetchImpl?: typeof fetch;
  /** Base URL — varsayılan '' (same-origin) */
  baseUrl?: string;
}

export class OkxClient {
  private readonly isDemoMode: () => boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: OkxClientOptions) {
    this.isDemoMode = options.isDemoMode;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "";
  }

  /**
   * OKX GET — panel `okxFetch` analogu.
   *
   * @param path '/api/v5/...' formatında, query string dahil
   */
  async fetch<T = unknown>(path: string): Promise<ParsedOkxResponse<T>> {
    return this.request<T>("GET", path);
  }

  /**
   * OKX POST — panel `okxPost` analogu.
   *
   * @param path '/api/v5/...' formatında
   * @param body OKX payload (server tarafı bunu OKX'e iletecek)
   */
  async post<T = unknown>(
    path: string,
    body: unknown,
  ): Promise<ParsedOkxResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(
    method: OkxMethod,
    path: string,
    body?: unknown,
  ): Promise<ParsedOkxResponse<T>> {
    if (!path.startsWith("/api/v5/")) {
      return { ok: false, err: "INVALID_PATH" };
    }

    // Path'ten query string'i ayır, proxy URL'sini inşa et
    // /api/okx/<okxPath><?query>
    const proxyUrl = `${this.baseUrl}/api/okx${path}`;

    try {
      const init: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(method === "GET" && {
            "X-OKX-Mode": this.isDemoMode() ? "demo" : "prod",
          }),
        },
      };
      if (method === "POST") {
        init.body = JSON.stringify({
          isDemo: this.isDemoMode(),
          body: body ?? {},
        });
      }

      const res = await this.fetchImpl(proxyUrl, init);
      const data = (await res.json()) as ParsedOkxResponse<T>;
      return data;
    } catch (e) {
      const err = e as { message?: string };
      return { ok: false, err: err.message ?? "NETWORK_ERROR" };
    }
  }
}
