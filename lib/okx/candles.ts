/**
 * OKX CANDLES — Mum verisi çekme.
 *
 * `/api/v5/market/candles` endpoint'i:
 *   - instId: "BTC-USDT-SWAP"
 *   - bar: "4H", "1H", "15m", "5m", ...
 *   - limit: max 300
 *
 * Response format (string array):
 *   [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
 *
 * confirm=1 → mum kapandı, confirm=0 → güncel/açık mum
 *
 * Bu modül saf veri katmanı: fetch + parse + Zod validate. Caller (store)
 * polling yönetir.
 */

import { z } from "zod";
import type { Pair } from "@/lib/constants/pairs";

/** Bir adet mum (parse edilmiş hali) */
export interface Candle {
  ts: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base ccy volume
  confirm: boolean; // true = kapanmış mum
}

/** İndikatör format'ına çevir (o, h, l, c, v, t) */
export function toIndicatorCandle(c: Candle): {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
} {
  return {
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
    t: c.ts,
  };
}

/** OKX raw response: data array içinde string array'ler */
const okxCandleSchema = z.object({
  code: z.string(),
  data: z.array(z.array(z.string()).min(7)),
  msg: z.string().optional(),
});

/** Pair → OKX instId */
function instIdFor(pair: Pair): string {
  return `${pair}-USDT-SWAP`;
}

/** Timeframe → OKX bar */
export type Timeframe = "1d" | "4h" | "1h" | "15m" | "5m";
function barFor(tf: Timeframe): string {
  // OKX bar formatları: "1D", "4H", "1H", "15m", "5m"
  if (tf === "1d") return "1D";
  if (tf === "4h") return "4H";
  if (tf === "1h") return "1H";
  return tf;
}

/** OKX raw candle row → Candle */
function parseCandleRow(row: readonly string[]): Candle | null {
  if (row.length < 9) return null;
  const ts = parseInt(row[0], 10);
  const open = parseFloat(row[1]);
  const high = parseFloat(row[2]);
  const low = parseFloat(row[3]);
  const close = parseFloat(row[4]);
  const volume = parseFloat(row[5]);
  const confirm = row[8] === "1";
  if (
    !isFinite(ts) ||
    !isFinite(open) ||
    !isFinite(high) ||
    !isFinite(low) ||
    !isFinite(close) ||
    !isFinite(volume)
  ) {
    return null;
  }
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  return { ts, open, high, low, close, volume, confirm };
}

/**
 * OKX API yanıtı → Candle[]
 * Eski → yeni sıralama (OKX yeni → eski döndürür, biz tersliyoruz).
 */
export function parseCandleResponse(raw: unknown): Candle[] | null {
  const r = okxCandleSchema.safeParse(raw);
  if (!r.success) return null;
  if (r.data.code !== "0") return null;
  const candles: Candle[] = [];
  for (const row of r.data.data) {
    const c = parseCandleRow(row);
    if (c) candles.push(c);
  }
  if (candles.length === 0) return null;
  // OKX en yeni mum başta döndürür, ts'e göre artan sırala
  candles.sort((a, b) => a.ts - b.ts);
  return candles;
}

/** HTTP fetch arayüzü (test mock'u için) */
export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Mum verilerini çek.
 *
 * @param pair BTC | ETH
 * @param tf Timeframe ("4h", "1h", "15m", "5m")
 * @param limit Max 300, default 200
 * @param fetchFn HTTP fetch (default global)
 */
export async function fetchCandles(
  pair: Pair,
  tf: Timeframe,
  limit: number = 200,
  fetchFn?: FetchFn,
): Promise<Candle[] | null> {
  const fn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const instId = instIdFor(pair);
  const bar = barFor(tf);
  const url = `/api/okx/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(300, limit)}`;
  try {
    const res = await fn(url);
    if (!res.ok) return null;
    const raw = await res.json();
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    // ── Yanıt formatı tespiti (3 olası şekil) ──
    //
    // 1) Proxy zarfı (GERÇEK ÜRETİM YOLU):
    //    server-handler → parseOkxEnvelope → { ok: true, data: <OKX data array> }
    //    Burada `code` SOYULMUŞ, `data` doğrudan mum satırları array'i.
    //
    // 2) Proxy zarfı iç içe (eski/teorik):
    //    { ok: true, data: { code, data } }
    //
    // 3) Direkt OKX yanıtı (test mock'u):
    //    { code: "0", data: [...] }

    // (1) ve (2): proxy zarfı — önce ok kontrolü
    if (typeof r.ok === "boolean") {
      if (!r.ok) return null; // proxy hata döndü (NO_KEYS, TIMEOUT, vs.)
      const inner = r.data;
      if (Array.isArray(inner)) {
        // (1) data doğrudan mum array'i → OKX envelope'una geri sar
        return parseCandleResponse({ code: "0", data: inner });
      }
      if (inner && typeof inner === "object") {
        // (2) iç içe { code, data }
        return parseCandleResponse(inner);
      }
      return null;
    }

    // (3) Direkt OKX response: { code: "0", data: [...] }
    if (typeof r.code === "string") {
      return parseCandleResponse(raw);
    }

    return null;
  } catch {
    return null;
  }
}
