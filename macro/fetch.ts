/**
 * MACRO — HTTP fetch katmanı.
 * Kaynak: panel_v55_51.html satır 7132-7159.
 *
 * Panel mantığı v2'de korundu:
 *   - 4 saniye timeout (AbortController)
 *   - Try/catch, hata durumunda fallback değer (F&G=50, dom=0)
 *
 * v2 yenilik:
 *   - In-memory cache (30dk TTL)
 *   - fetch parametrik (test için mock'lanabilir)
 */

import { MACRO_CONSTANTS } from "./types";
import type { FearGreedResult, DominanceResult } from "./types";
import { cacheGet, cacheSet } from "./cache";

/** HTTP fetch alıyor — global fetch veya test mock'u */
export type FetchFn = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const FG_CACHE_KEY = "macro:fg";
const DOM_CACHE_KEY = "macro:dom";

interface FearGreedResponse {
  data?: ReadonlyArray<{ value?: string | number }>;
}

interface DominanceResponse {
  data?: {
    market_cap_percentage?: {
      btc?: number;
      usdt?: number;
    };
  };
}

/**
 * Fetch helper — timeout + try/catch + safe JSON parse.
 */
async function timedFetch(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * F&G fetch — cache → api → fallback sırasıyla.
 *
 * @param now Şu an (cache TTL hesabı için)
 * @param fetchFn HTTP fetch fonksiyonu (default global fetch)
 * @returns FearGreedResult (her zaman değer döner — fallback varsa source='fallback')
 */
export async function fetchFearGreed(
  now: number,
  fetchFn: FetchFn = globalThis.fetch as FetchFn,
): Promise<FearGreedResult> {
  // 1. Cache kontrol
  const cached = cacheGet<FearGreedResult>(FG_CACHE_KEY, now);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  // 2. API çağrı
  const data = (await timedFetch(
    fetchFn,
    "https://api.alternative.me/fng/?limit=1",
    MACRO_CONSTANTS.FETCH_TIMEOUT_MS,
  )) as FearGreedResponse | null;

  if (data && data.data && data.data[0] && data.data[0].value !== undefined) {
    const raw = data.data[0].value;
    const value = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      const result: FearGreedResult = {
        value,
        fetchedAt: now,
        source: "api",
      };
      cacheSet(FG_CACHE_KEY, result, now, MACRO_CONSTANTS.FG_CACHE_TTL_MS);
      return result;
    }
  }

  // 3. Fallback (panel'de "ST.macro.fg = 50")
  return {
    value: MACRO_CONSTANTS.FG_FALLBACK,
    fetchedAt: now,
    source: "fallback",
  };
}

/**
 * BTC Dominance fetch — cache → api → fallback.
 */
export async function fetchBtcDominance(
  now: number,
  fetchFn: FetchFn = globalThis.fetch as FetchFn,
): Promise<DominanceResult> {
  const cached = cacheGet<DominanceResult>(DOM_CACHE_KEY, now);
  if (cached) {
    return { ...cached, source: "cache" };
  }

  const data = (await timedFetch(
    fetchFn,
    "https://api.coingecko.com/api/v3/global",
    MACRO_CONSTANTS.FETCH_TIMEOUT_MS,
  )) as DominanceResponse | null;

  if (data && data.data && data.data.market_cap_percentage) {
    const btcD = data.data.market_cap_percentage.btc;
    const usdtD = data.data.market_cap_percentage.usdt;
    if (
      typeof btcD === "number" &&
      typeof usdtD === "number" &&
      btcD > 0 &&
      usdtD > 0
    ) {
      const result: DominanceResult = {
        btcD,
        usdtD,
        fetchedAt: now,
        source: "api",
      };
      cacheSet(DOM_CACHE_KEY, result, now, MACRO_CONSTANTS.DOM_CACHE_TTL_MS);
      return result;
    }
  }

  return {
    btcD: MACRO_CONSTANTS.DOM_BTC_FALLBACK,
    usdtD: MACRO_CONSTANTS.DOM_USDT_FALLBACK,
    fetchedAt: now,
    source: "fallback",
  };
}
