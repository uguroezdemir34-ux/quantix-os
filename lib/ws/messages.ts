/**
 * WS MESSAGES — OKX ve Binance mesaj parser'ları.
 *
 * Tüm fonksiyonlar SAF: input mesaj → Tick[] | null. Side-effect yok,
 * test edilebilir. Bozuk veya tanınmayan mesajlar `null` döner (silent reject).
 *
 * Kaynak: panel_v55_51.html satır 6140-6201.
 */

import { z } from "zod";
import { PAIRS, type Pair } from "@/lib/constants/pairs";
import type { Tick } from "./types";

// ═══════════════ ZOD SCHEMA'LARI ═══════════════

const okxTickerSchema = z.object({
  arg: z.object({
    channel: z.literal("tickers"),
    instId: z.string(),
  }),
  data: z
    .array(
      z.object({
        instId: z.string(),
        last: z.string(),
        open24h: z.string().optional(),
      }),
    )
    .min(1),
});

const okxTradeSchema = z.object({
  arg: z.object({
    channel: z.literal("trades"),
    instId: z.string(),
  }),
  data: z
    .array(
      z.object({
        instId: z.string(),
        px: z.string(),
      }),
    )
    .min(1),
});

const binanceTickerSchema = z.object({
  stream: z.string(),
  data: z.object({
    s: z.string(), // symbol (BTCUSDT)
    c: z.string(), // close
    o: z.string().optional(), // open24h
  }),
});

// ═══════════════ HELPER ═══════════════

/** OKX instId formatı: "BTC-USDT-SWAP" → "BTC" */
function extractPairFromInstId(instId: string): Pair | null {
  const sym = instId.split("-")[0];
  if (PAIRS.includes(sym as Pair)) return sym as Pair;
  return null;
}

/** Binance symbol formatı: "BTCUSDT" → "BTC" */
function extractPairFromBinanceSymbol(symbol: string): Pair | null {
  const sym = symbol.replace("USDT", "");
  if (PAIRS.includes(sym as Pair)) return sym as Pair;
  return null;
}

/** % değişim hesapla */
function calcChg(last: number, open24h: number): number {
  return open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;
}

// ═══════════════ PARSER'LAR ═══════════════

/**
 * OKX ticker mesajı (snapshot, 100-300ms aralıkla).
 *
 * @returns Geçerli ticker mesajı ise Tick, değilse null.
 */
export function parseOkxTicker(msg: unknown, now: number): Tick | null {
  const r = okxTickerSchema.safeParse(msg);
  if (!r.success) return null;
  const t = r.data.data[0];
  const pair = extractPairFromInstId(t.instId);
  if (!pair) return null;
  const last = parseFloat(t.last);
  if (!isFinite(last) || last <= 0) return null;
  const open24h = t.open24h ? parseFloat(t.open24h) : last;
  return {
    pair,
    last,
    open24h: isFinite(open24h) && open24h > 0 ? open24h : last,
    chg: calcChg(last, open24h),
    ts: now,
    source: "ticker",
  };
}

/**
 * OKX trade mesajı (gerçek alım/satım, 1-100ms).
 *
 * Önemli: trade mesajında open24h **yok**, bu yüzden chg hesabı için
 * mevcut open24h değeri parametre olarak alınır (genelde son ticker'dan).
 *
 * @param open24hByPair Pair → son bilinen open24h (chg hesabı için)
 */
export function parseOkxTrades(
  msg: unknown,
  now: number,
  open24hByPair: Partial<Record<Pair, number>>,
): Tick[] | null {
  const r = okxTradeSchema.safeParse(msg);
  if (!r.success) return null;
  const ticks: Tick[] = [];
  for (const tr of r.data.data) {
    const pair = extractPairFromInstId(tr.instId);
    if (!pair) continue;
    const last = parseFloat(tr.px);
    if (!isFinite(last) || last <= 0) continue;
    const open24h = open24hByPair[pair] ?? last;
    ticks.push({
      pair,
      last,
      open24h,
      chg: calcChg(last, open24h),
      ts: now,
      source: "trade",
    });
  }
  return ticks.length > 0 ? ticks : null;
}

/**
 * Binance combined stream ticker.
 */
export function parseBinanceTicker(msg: unknown, now: number): Tick | null {
  const r = binanceTickerSchema.safeParse(msg);
  if (!r.success) return null;
  const pair = extractPairFromBinanceSymbol(r.data.data.s);
  if (!pair) return null;
  const last = parseFloat(r.data.data.c);
  if (!isFinite(last) || last <= 0) return null;
  const open24h = r.data.data.o ? parseFloat(r.data.data.o) : last;
  return {
    pair,
    last,
    open24h: isFinite(open24h) && open24h > 0 ? open24h : last,
    chg: calcChg(last, open24h),
    ts: now,
    source: "ticker",
  };
}

/**
 * Genel parser — herhangi bir formatı dene.
 * UI/store tarafından kullanılır, tipi bilmesi gerekmez.
 *
 * @returns Tick[] (Binance/OKX ticker tek elemanlı array, trade çoklu olabilir)
 *          null = tanınmayan mesaj, silent atla
 */
export function parseAnyMessage(
  msg: unknown,
  now: number,
  open24hByPair: Partial<Record<Pair, number>>,
): Tick[] | null {
  // Binance: { stream, data } yapısı
  if (msg && typeof msg === "object" && "stream" in msg) {
    const tick = parseBinanceTicker(msg, now);
    return tick ? [tick] : null;
  }
  // OKX: { arg: { channel, instId }, data: [...] }
  if (msg && typeof msg === "object" && "arg" in msg && "data" in msg) {
    const arg = (msg as { arg?: { channel?: string } }).arg;
    if (arg?.channel === "tickers") {
      const tick = parseOkxTicker(msg, now);
      return tick ? [tick] : null;
    }
    if (arg?.channel === "trades") {
      return parseOkxTrades(msg, now, open24hByPair);
    }
  }
  return null;
}
