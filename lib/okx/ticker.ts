/**
 * OKX REST TICKER — Anlık fiyat (WS fallback için).
 *
 * `/api/v5/market/ticker?instId=<symbol>` endpoint'i tek pair için
 * snapshot fiyat döndürür. WS koptuğunda REST yedek hattı olarak kullanılır.
 *
 * Proxy: /api/okx/api/v5/market/ticker
 */

import type { Pair } from "@/lib/constants/pairs";
import type { Tick } from "@/lib/ws/types";

const PAIR_TO_INST: Record<Pair, string> = {
  BTC: "BTC-USDT-SWAP",
  ETH: "ETH-USDT-SWAP",
};

/**
 * OKX REST ticker → Tick (WS formatıyla uyumlu).
 * Başarısızsa null döner (caller log'u yönetir).
 */
export async function fetchRestTicker(
  pair: Pair,
  now: number = Date.now(),
): Promise<Tick | null> {
  const instId = PAIR_TO_INST[pair];
  try {
    const res = await fetch(
      `/api/okx/api/v5/market/ticker?instId=${instId}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as unknown;
    const data = extractTickerData(json);
    if (!data) return null;

    const last = parseFloat(data.last);
    const open24h = parseFloat(data.open24h);
    if (!isFinite(last) || last <= 0) return null;

    const chg = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0;

    return {
      pair,
      last,
      open24h: isFinite(open24h) ? open24h : last,
      chg,
      ts: now,
      source: "ticker",
    };
  } catch {
    return null;
  }
}

// ─── Parse helper ────────────────────────────────────────────

interface RawTickerData {
  last: string;
  open24h: string;
}

function extractTickerData(json: unknown): RawTickerData | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;

  // Format 1: { data: [{ last, open24h }] }
  if (Array.isArray(j.data) && j.data.length > 0) {
    const item = j.data[0] as Record<string, unknown>;
    if (typeof item.last === "string" && typeof item.open24h === "string") {
      return { last: item.last, open24h: item.open24h };
    }
  }

  // Format 2: { last, open24h } (direct)
  if (typeof j.last === "string" && typeof j.open24h === "string") {
    return { last: j.last, open24h: j.open24h };
  }

  return null;
}
