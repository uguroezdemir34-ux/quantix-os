/**
 * OKX ADAPTER — ExchangeAdapter gerçek implementasyonu.
 *
 * Tüm OKX V5 istekleri /api/okx/api/v5/... proxy üzerinden gider.
 * Secret asla browser'a çıkmaz.
 *
 * Desteklenen işlemler:
 *   openPosition  → market order + SL/TP algo emirleri
 *   closePosition → market close (autoCxl=true algo'ları da kapatır)
 *   cancelAlgoOrders → elle algo iptal (trailing stop için)
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

const ALGO_ORD_TYPES = [
  "conditional",
  "oco",
  "trigger",
  "move_order_stop",
] as const;

/** Retry: max N kez, exponential backoff */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastError;
}

/** Proxy'ye POST — isDemo settingsStore'dan okunur */
async function proxyPost(
  path: string,
  body: unknown,
  isDemo: boolean,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/okx${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isDemo, body }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** Proxy'ye GET */
async function proxyGet(
  path: string,
  isDemo: boolean,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/okx${path}`, {
    method: "GET",
    headers: { "X-OKX-Mode": isDemo ? "demo" : "prod" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/** Proxy yanıtından OKX kod kontrolü */
function checkProxyResponse(raw: Record<string, unknown>): {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  data?: unknown;
} {
  // Proxy zarfı: { ok: boolean, data?, err? }
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
  // Direkt OKX yanıtı
  if (raw.code === "0") {
    return { ok: true, data: raw.data };
  }
  return {
    ok: false,
    errorCode: String(raw.code ?? ""),
    errorMessage: String(raw.msg ?? "Unknown OKX error"),
  };
}

export class OkxAdapter implements ExchangeAdapter {
  constructor(private readonly isDemo: boolean) {}

  /**
   * Pozisyon aç.
   *
   * Akış:
   *   1. Market order (tdMode=cross/isolated, side=buy/sell, ordType=market)
   *   2. Başarılıysa SL algo order (conditional, triggerPx=slPrice)
   *   3. Başarılıysa TP algo order(lar) (oco veya conditional)
   *
   * OKX V5: POST /api/v5/trade/order
   */
  async openPosition(
    input: OpenPositionInput,
  ): Promise<AdapterResult<TradeData>> {
    const instId = pairToInstId(input.pair);
    const side = input.direction === "LONG" ? "buy" : "sell";
    const posSide = input.direction === "LONG" ? "long" : "short";

    // ─── 1. Market order ───
    let orderResult: Record<string, unknown>;
    try {
      orderResult = await withRetry(() =>
        proxyPost(
          "/api/v5/trade/order",
          {
            instId,
            tdMode: input.marginMode,
            side,
            posSide,
            ordType: "market",
            sz: String(input.qty),
            lever: String(input.leverage),
          },
          this.isDemo,
        ),
      );
    } catch (e) {
      return {
        ok: false,
        errorKind: "NETWORK",
        errorMessage: e instanceof Error ? e.message : "Network error",
      };
    }

    const orderCheck = checkProxyResponse(orderResult);
    if (!orderCheck.ok) {
      return {
        ok: false,
        errorKind: `OKX_${orderCheck.errorCode ?? "ERR"}`,
        errorMessage: orderCheck.errorMessage,
      };
    }

    // OKX order yanıtından ordId çıkar
    const dataArr = Array.isArray(orderCheck.data) ? orderCheck.data : [];
    const firstItem = (dataArr[0] ?? {}) as Record<string, unknown>;
    const orderId = String(firstItem.ordId ?? "");

    // ─── 2. SL algo order ───
    if (input.slPrice && input.slPrice > 0) {
      const slSide = input.direction === "LONG" ? "sell" : "buy";
      const slPosSide = input.direction === "LONG" ? "long" : "short";
      try {
        await withRetry(() =>
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
              slOrdPx: "-1", // market fiyatla kapat
              slTriggerPxType: "last",
            },
            this.isDemo,
          ),
        );
      } catch {
        // SL başarısız — kritik ama pozisyon açıldı, devam et + log
        console.warn(`[OkxAdapter] SL algo order failed for ${instId}`);
      }
    }

    // ─── 3. TP algo order(lar) ───
    const tpTargets: Array<{ price: number; qty: number }> = [];
    if (input.tp1Price && input.tp1Price > 0) {
      // TP1: yarı pozisyon
      tpTargets.push({ price: input.tp1Price, qty: input.qty / 2 });
    }
    if (input.tp2Price && input.tp2Price > 0) {
      // TP2: kalan yarı
      tpTargets.push({ price: input.tp2Price, qty: input.qty / 2 });
    }

    for (const tp of tpTargets) {
      const tpSide = input.direction === "LONG" ? "sell" : "buy";
      const tpPosSide = input.direction === "LONG" ? "long" : "short";
      try {
        await withRetry(() =>
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
          ),
        );
      } catch {
        console.warn(`[OkxAdapter] TP algo order failed for ${instId}`);
      }
    }

    return {
      ok: true,
      data: {
        orderId,
        instId,
      },
    };
  }

  /**
   * Pozisyonu kapat.
   *
   * autoCxl=true: OKX bağlı algo emirlerini otomatik iptal eder.
   * OKX V5: POST /api/v5/trade/close-position
   */
  async closePosition(
    input: ClosePositionInput,
  ): Promise<AdapterResult<void>> {
    const body: Record<string, unknown> = {
      instId: input.instId,
      mgnMode: input.mgnMode,
      autoCxl: true,
      ccy: "USDT",
    };
    if (input.posSide) {
      body.posSide = input.posSide;
    }

    let raw: Record<string, unknown>;
    try {
      raw = await withRetry(() =>
        proxyPost("/api/v5/trade/close-position", body, this.isDemo),
      );
    } catch (e) {
      return {
        ok: false,
        errorKind: "NETWORK",
        errorMessage: e instanceof Error ? e.message : "Network error",
      };
    }

    const check = checkProxyResponse(raw);
    if (!check.ok) {
      return {
        ok: false,
        errorKind: `OKX_${check.errorCode ?? "ERR"}`,
        errorMessage: check.errorMessage,
      };
    }

    return { ok: true };
  }

  /**
   * Tüm bekleyen algo emirlerini iptal et.
   *
   * OKX V5 gereği: her ordType ayrı ayrı sorgulanır.
   * GET  /api/v5/trade/orders-algo-pending?ordType=...&instId=...
   * POST /api/v5/trade/cancel-algos
   */
  async cancelAlgoOrders(instId: string): Promise<AdapterResult<void>> {
    const collected: Array<{ algoId: string; instId: string }> = [];

    for (const ordType of ALGO_ORD_TYPES) {
      try {
        const raw = await proxyGet(
          `/api/v5/trade/orders-algo-pending?ordType=${ordType}&instId=${encodeURIComponent(instId)}`,
          this.isDemo,
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

    if (collected.length === 0) {
      return { ok: true }; // İptal edilecek emir yok
    }

    try {
      const raw = await withRetry(() =>
        proxyPost("/api/v5/trade/cancel-algos", collected, this.isDemo),
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
}

/**
 * Singleton adapter — isDemo settingsStore'dan alınır.
 * Her çağrıda yeni instance yaratmak yerine memoize.
 */
let _adapterInstance: OkxAdapter | null = null;
let _adapterIsDemo: boolean | null = null;

export function getOkxAdapter(isDemo: boolean): OkxAdapter {
  if (_adapterInstance === null || _adapterIsDemo !== isDemo) {
    _adapterInstance = new OkxAdapter(isDemo);
    _adapterIsDemo = isDemo;
  }
  return _adapterInstance;
}
