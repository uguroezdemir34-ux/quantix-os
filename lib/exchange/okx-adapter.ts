/**
 * OKX ADAPTER — ExchangeAdapter gerçek implementasyonu.
 *
 * Tüm OKX V5 istekleri /api/okx/api/v5/... proxy üzerinden gider.
 * Secret asla browser'a çıkmaz.
 *
 * Güvenlik katmanları:
 *   1. Token Bucket Rate Limiter — IP ban koruması
 *   2. Idempotency Guard — Ghost Order (hayalet emir) koruması
 *   3. AbortController timeout — sonsuz bekleme koruması
 *   4. Akıllı retry — sadece network hatası retry'lanır, timeout/OKX hata retry'lanmaz
 *
 * OKX V5 Referans:
 *   POST /api/v5/trade/order
 *   POST /api/v5/trade/close-position
 *   GET  /api/v5/trade/orders-algo-pending
 *   POST /api/v5/trade/cancel-algos
 */

import type {
  ExchangeAdapter,
  OpenPositionInput,
  ClosePositionInput,
  AdapterResult,
  TradeData,
} from "./types";
import { pairToInstId } from "./okx/symbol-format";
import {
  TokenBucketRateLimiter,
  createOkxTradeLimiter,
  createOkxAlgoLimiter,
} from "./rate-limiter";
import { IdempotencyGuard } from "./idempotency";

// ─── Sabitler ────────────────────────────────────────────────

/** Her istek için maksimum bekleme süresi (ms) */
const REQUEST_TIMEOUT_MS = 10_000;

/** Market order için retry sayısı (sadece network hatası) */
const ORDER_MAX_RETRIES = 2;

/** Retry base delay (ms) */
const RETRY_BASE_DELAY_MS = 500;

const ALGO_ORD_TYPES = [
  "conditional",
  "oco",
  "trigger",
  "move_order_stop",
] as const;

// ─── Adapter seçenekleri (DI / test) ─────────────────────────

export interface OkxAdapterOptions {
  isDemo: boolean;
  /** Rate limiter inject (test için) */
  tradeLimiter?: TokenBucketRateLimiter;
  algoLimiter?: TokenBucketRateLimiter;
  /** Idempotency guard inject (test için) */
  idempotencyGuard?: IdempotencyGuard;
  /** fetch inject (test için) */
  fetchFn?: typeof fetch;
  /** Timeout ms (test için küçültülebilir) */
  timeoutMs?: number;
}

// ─── HTTP helpers ─────────────────────────────────────────────

/**
 * Timeout'lu fetch — AbortController ile.
 * Request timeout olursa AbortError fırlatır.
 */
async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Proxy'ye POST */
async function proxyPost(
  path: string,
  body: unknown,
  isDemo: boolean,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(
    `/api/okx${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDemo, body }),
    },
    timeoutMs,
    fetchFn,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** Proxy'ye GET */
async function proxyGet(
  path: string,
  isDemo: boolean,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(
    `/api/okx${path}`,
    {
      method: "GET",
      headers: { "X-OKX-Mode": isDemo ? "demo" : "prod" },
    },
    timeoutMs,
    fetchFn,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** OKX proxy yanıtını parse et */
function checkProxyResponse(raw: Record<string, unknown>): {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  data?: unknown;
} {
  if (typeof raw.ok === "boolean") {
    if (!raw.ok) {
      return {
        ok: false,
        errorCode: String(raw.code ?? ""),
        errorMessage: String(raw.err ?? "Unknown error"),
      };
    }
    return { ok: true, data: raw.data };
  }
  if (raw.code === "0") {
    return { ok: true, data: raw.data };
  }
  return {
    ok: false,
    errorCode: String(raw.code ?? ""),
    errorMessage: String(raw.msg ?? "Unknown OKX error"),
  };
}

/** Timeout AbortError mi? */
function isTimeoutError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === "AbortError" || e.message.includes("abort"))
  );
}

// ─── Akıllı retry — sadece network hatası ─────────────────────

/**
 * Network hataları için exponential backoff retry.
 *
 * Timeout ve OKX uygulama hataları retry'lanmaz:
 *   - Timeout → ghost order riski
 *   - OKX error → idempotent değil, aynı parametreler tekrar reddedilir
 */
async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  maxRetries = ORDER_MAX_RETRIES,
  baseDelay = RETRY_BASE_DELAY_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      // Timeout → retry yapma (ghost order riski)
      if (isTimeoutError(e)) throw e;
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) =>
          setTimeout(r, baseDelay * Math.pow(2, attempt)),
        );
      }
    }
  }
  throw lastError;
}

// ─── Adapter ─────────────────────────────────────────────────

export class OkxAdapter implements ExchangeAdapter {
  private readonly isDemo: boolean;
  private readonly tradeLimiter: TokenBucketRateLimiter;
  private readonly algoLimiter: TokenBucketRateLimiter;
  private readonly guard: IdempotencyGuard;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OkxAdapterOptions) {
    this.isDemo = opts.isDemo;
    this.tradeLimiter = opts.tradeLimiter ?? createOkxTradeLimiter();
    this.algoLimiter = opts.algoLimiter ?? createOkxAlgoLimiter();
    this.guard = opts.idempotencyGuard ?? new IdempotencyGuard();
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * Pozisyon aç.
   *
   * Akış:
   *   0. Rate limiter token al
   *   1. clOrdId üret + idempotency kaydı aç
   *   2. Market order gönder (timeout korumalı)
   *   3. Başarı → markDone; Timeout → markTimeout; Network → markNetworkFailed
   *   4. Başarılıysa SL algo order
   *   5. Başarılıysa TP algo order(lar)
   */
  async openPosition(
    input: OpenPositionInput,
  ): Promise<AdapterResult<TradeData>> {
    const instId = pairToInstId(input.pair);
    const side = input.direction === "LONG" ? "buy" : "sell";
    const posSide = input.direction === "LONG" ? "long" : "short";

    // ─── Rate limit ───
    await this.tradeLimiter.acquire();

    // ─── Ghost order guard ───
    const clOrdId = this.guard.register();

    // ─── Market order ───
    let orderId = "";
    try {
      const resolvedOrdType = input.ordType ?? "market";
      const orderBody: Record<string, unknown> = {
        instId,
        tdMode: input.marginMode,
        side,
        posSide,
        ordType: resolvedOrdType,
        sz: String(input.qty),
        lever: String(input.leverage),
        clOrdId,
      };
      // Limit / Post-Only: fiyat zorunlu
      if (resolvedOrdType !== "market" && input.limitPx && input.limitPx > 0) {
        orderBody.px = String(input.limitPx);
      } else if (resolvedOrdType !== "market") {
        // Fiyat verilmediyse market'a düş
        orderBody.ordType = "market";
        delete orderBody.px;
      }

      const orderResult = await withNetworkRetry(() =>
        proxyPost(
          "/api/v5/trade/order",
          orderBody,
          this.isDemo,
          this.timeoutMs,
          this.fetchFn,
        ),
      );

      const orderCheck = checkProxyResponse(orderResult);
      if (!orderCheck.ok) {
        this.guard.markOkxError(clOrdId);
        return {
          ok: false,
          errorKind: `OKX_${orderCheck.errorCode ?? "ERR"}`,
          errorMessage: orderCheck.errorMessage,
        };
      }

      const dataArr = Array.isArray(orderCheck.data) ? orderCheck.data : [];
      const firstItem = (dataArr[0] ?? {}) as Record<string, unknown>;
      orderId = String(firstItem.ordId ?? "");
      this.guard.markDone(clOrdId, orderId);
    } catch (e) {
      if (isTimeoutError(e)) {
        this.guard.markTimeout(clOrdId);
        return {
          ok: false,
          errorKind: "TIMEOUT_UNKNOWN",
          errorMessage:
            `Order timeout after ${this.timeoutMs}ms — clOrdId: ${clOrdId}. ` +
            "Status unknown, do NOT retry without checking OKX order status.",
        };
      }
      this.guard.markNetworkFailed(clOrdId);
      return {
        ok: false,
        errorKind: "NETWORK",
        errorMessage: e instanceof Error ? e.message : "Network error",
      };
    }

    // ─── SL algo order ───
    if (input.slPrice && input.slPrice > 0) {
      await this.algoLimiter.acquire();
      const slSide = input.direction === "LONG" ? "sell" : "buy";
      const slPosSide = posSide;
      try {
        await withNetworkRetry(() =>
          proxyPost(
            "/api/v5/trade/order-algo",
            {
              instId,
              tdMode: input.marginMode,
              side: slSide,
              posSide: slPosSide,
              ordType: "conditional",
              sz: String(input.qty),
              slTriggerPx: String(input.slPrice),
              slOrdPx: "-1",
              slTriggerPxType: "last",
            },
            this.isDemo,
            this.timeoutMs,
            this.fetchFn,
          ),
        );
      } catch {
        console.warn(`[OkxAdapter] SL algo order failed for ${instId}`);
      }
    }

    // ─── TP algo order(lar) ───
    const tpTargets: Array<{ price: number; qty: number }> = [];
    if (input.tp1Price && input.tp1Price > 0) {
      tpTargets.push({ price: input.tp1Price, qty: input.qty / 2 });
    }
    if (input.tp2Price && input.tp2Price > 0) {
      tpTargets.push({ price: input.tp2Price, qty: input.qty / 2 });
    }

    for (const tp of tpTargets) {
      await this.algoLimiter.acquire();
      const tpSide = input.direction === "LONG" ? "sell" : "buy";
      const tpPosSide = posSide;
      try {
        await withNetworkRetry(() =>
          proxyPost(
            "/api/v5/trade/order-algo",
            {
              instId,
              tdMode: input.marginMode,
              side: tpSide,
              posSide: tpPosSide,
              ordType: "conditional",
              sz: String(tp.qty),
              tpTriggerPx: String(tp.price),
              tpOrdPx: "-1",
              tpTriggerPxType: "last",
            },
            this.isDemo,
            this.timeoutMs,
            this.fetchFn,
          ),
        );
      } catch {
        console.warn(`[OkxAdapter] TP algo order failed for ${instId}`);
      }
    }

    return { ok: true, data: { orderId, instId } };
  }

  /**
   * Pozisyonu kapat.
   */
  async closePosition(
    input: ClosePositionInput,
  ): Promise<AdapterResult<void>> {
    await this.tradeLimiter.acquire();

    const body: Record<string, unknown> = {
      instId: input.instId,
      mgnMode: input.mgnMode,
      autoCxl: true,
      ccy: "USDT",
    };
    if (input.posSide) body.posSide = input.posSide;

    try {
      const raw = await withNetworkRetry(() =>
        proxyPost(
          "/api/v5/trade/close-position",
          body,
          this.isDemo,
          this.timeoutMs,
          this.fetchFn,
        ),
      );
      const check = checkProxyResponse(raw);
      if (!check.ok) {
        return {
          ok: false,
          errorKind: `OKX_${check.errorCode ?? "ERR"}`,
          errorMessage: check.errorMessage,
        };
      }
      return { ok: true };
    } catch (e) {
      if (isTimeoutError(e)) {
        return {
          ok: false,
          errorKind: "TIMEOUT_UNKNOWN",
          errorMessage: `closePosition timeout after ${this.timeoutMs}ms`,
        };
      }
      return {
        ok: false,
        errorKind: "NETWORK",
        errorMessage: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  /**
   * Tüm bekleyen algo emirlerini iptal et.
   */
  async cancelAlgoOrders(instId: string): Promise<AdapterResult<void>> {
    const collected: Array<{ algoId: string; instId: string }> = [];

    for (const ordType of ALGO_ORD_TYPES) {
      await this.algoLimiter.acquire();
      try {
        const raw = await proxyGet(
          `/api/v5/trade/orders-algo-pending?ordType=${ordType}&instId=${encodeURIComponent(instId)}`,
          this.isDemo,
          this.timeoutMs,
          this.fetchFn,
        );
        const check = checkProxyResponse(raw);
        if (!check.ok || !Array.isArray(check.data)) continue;

        for (const o of check.data as Array<Record<string, unknown>>) {
          if (
            typeof o.algoId === "string" &&
            typeof o.instId === "string" &&
            o.instId === instId
          ) {
            collected.push({ algoId: o.algoId, instId: o.instId });
          }
        }
      } catch {
        // Bu ordType sorgusu başarısız — devam et
      }
    }

    if (collected.length === 0) return { ok: true };

    await this.tradeLimiter.acquire();
    try {
      const raw = await withNetworkRetry(() =>
        proxyPost(
          "/api/v5/trade/cancel-algos",
          collected,
          this.isDemo,
          this.timeoutMs,
          this.fetchFn,
        ),
      );
      const check = checkProxyResponse(raw);
      if (!check.ok) {
        return {
          ok: false,
          errorKind: `OKX_${check.errorCode ?? "ERR"}`,
          errorMessage: check.errorMessage,
        };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        errorKind: "NETWORK",
        errorMessage: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  /** Idempotency guard'a erişim (test/debug için) */
  getGuard(): IdempotencyGuard {
    return this.guard;
  }
}

// ─── Singleton factory ────────────────────────────────────────

let _instance: OkxAdapter | null = null;
let _instanceIsDemo: boolean | null = null;

export function getOkxAdapter(isDemo: boolean): OkxAdapter {
  if (_instance === null || _instanceIsDemo !== isDemo) {
    _instance = new OkxAdapter({ isDemo });
    _instanceIsDemo = isDemo;
  }
  return _instance;
}
