/**
 * OKX POSITIONS — Açık pozisyon fetch + parse.
 *
 * `/api/v5/account/positions` (private endpoint, auth gerekli).
 * Response: { code, data: [{ instId, pos, posSide, avgPx, markPx, upl, lever, ... }] }
 *
 * Sadece BTC + ETH SWAP pozisyonları döner (v2 strategy).
 */

import { z } from "zod";
import type { Pair } from "@/lib/constants/pairs";
import { PAIRS } from "@/lib/constants/pairs";
import type { FetchFn } from "./candles";

/** Tek bir açık pozisyon (parse edilmiş hali) */
export interface Position {
  /** "BTC-USDT-SWAP" */
  instId: string;
  /** "BTC" | "ETH" */
  pair: Pair;
  /** "long" | "short" | "net" */
  posSide: "long" | "short" | "net";
  /** Yön (sayısal pos > 0 LONG, < 0 SHORT, net=0 NEUTRAL) */
  direction: "LONG" | "SHORT" | "NEUTRAL";
  /** Pozisyon boyutu (coin cinsi, mutlak değer) */
  size: number;
  /** Giriş ortalama fiyat */
  entryPx: number;
  /** Mark fiyatı (UPL hesabı için) */
  markPx: number;
  /** Unrealized P&L (USDT) */
  upl: number;
  /** ROE % (OKX'in dönüşü) */
  uplRatio: number;
  /** Kaldıraç */
  leverage: number;
  /** Margin mode */
  mgnMode: "cross" | "isolated";
  /** Notional (USDT) */
  notional: number;
  /** Liquidation fiyatı (varsa) */
  liqPx: number | null;
  /** Stop Loss trigger (algo order'dan merge edilebilir, başta yok) */
  slTriggerPx: number | null;
  /** Take Profit trigger */
  tpTriggerPx: number | null;
  /** Pozisyon açılış zamanı */
  cTime: number;
}

const positionRowSchema = z.object({
  instId: z.string(),
  posSide: z.string(),
  pos: z.string(),
  avgPx: z.string(),
  markPx: z.string().optional(),
  upl: z.string().optional(),
  uplRatio: z.string().optional(),
  lever: z.string().optional(),
  mgnMode: z.string().optional(),
  notionalUsd: z.string().optional(),
  liqPx: z.string().optional(),
  slTriggerPx: z.string().optional(),
  tpTriggerPx: z.string().optional(),
  cTime: z.string().optional(),
});

const positionResponseSchema = z.object({
  code: z.string(),
  data: z.array(positionRowSchema).optional(),
  msg: z.string().optional(),
});

/** Helper — string → number, geçersiz değerde fallback */
function num(s: string | undefined, fallback = 0): number {
  if (!s) return fallback;
  const n = parseFloat(s);
  return isFinite(n) ? n : fallback;
}

/** posSide + pos signal'inden yön çıkar */
function deriveDirection(
  posSide: string,
  posValue: number,
): "LONG" | "SHORT" | "NEUTRAL" {
  if (posSide === "long") return "LONG";
  if (posSide === "short") return "SHORT";
  // net mode (one-way)
  if (posValue > 0) return "LONG";
  if (posValue < 0) return "SHORT";
  return "NEUTRAL";
}

/** instId → Pair (sadece desteklenenler) */
function extractPair(instId: string): Pair | null {
  const sym = instId.split("-")[0];
  if (PAIRS.includes(sym as Pair)) return sym as Pair;
  return null;
}

/** Tek pozisyon row'unu parse et */
function parsePositionRow(raw: z.infer<typeof positionRowSchema>): Position | null {
  const pair = extractPair(raw.instId);
  if (!pair) return null;

  const posValue = num(raw.pos);
  if (posValue === 0) return null; // Boş pozisyon (kapanmış)

  const size = Math.abs(posValue);
  const entryPx = num(raw.avgPx);
  if (entryPx <= 0) return null;

  const posSide = (raw.posSide as Position["posSide"]) ?? "net";
  const validPosSide: Position["posSide"] =
    posSide === "long" || posSide === "short" ? posSide : "net";

  const mgnMode = (raw.mgnMode as Position["mgnMode"]) ?? "cross";
  const validMgnMode: Position["mgnMode"] =
    mgnMode === "isolated" ? "isolated" : "cross";

  const markPx = num(raw.markPx, entryPx);
  const notional = num(raw.notionalUsd, size * markPx);

  return {
    instId: raw.instId,
    pair,
    posSide: validPosSide,
    direction: deriveDirection(validPosSide, posValue),
    size,
    entryPx,
    markPx,
    upl: num(raw.upl),
    uplRatio: num(raw.uplRatio),
    leverage: num(raw.lever, 1),
    mgnMode: validMgnMode,
    notional,
    liqPx: raw.liqPx && num(raw.liqPx) > 0 ? num(raw.liqPx) : null,
    slTriggerPx: raw.slTriggerPx && num(raw.slTriggerPx) > 0 ? num(raw.slTriggerPx) : null,
    tpTriggerPx: raw.tpTriggerPx && num(raw.tpTriggerPx) > 0 ? num(raw.tpTriggerPx) : null,
    cTime: num(raw.cTime, Date.now()),
  };
}

/**
 * Raw OKX response → Position[]
 * Boş pozisyonları, geçersiz veya desteklenmeyen pair'leri eler.
 */
export function parsePositionResponse(raw: unknown): Position[] | null {
  const r = positionResponseSchema.safeParse(raw);
  if (!r.success) return null;
  if (r.data.code !== "0") return null;
  if (!r.data.data) return [];

  const positions: Position[] = [];
  for (const row of r.data.data) {
    const p = parsePositionRow(row);
    if (p) positions.push(p);
  }
  return positions;
}

/**
 * Açık pozisyonları çek.
 *
 * @param fetchFn HTTP fetch (default global)
 */
export async function fetchPositions(fetchFn?: FetchFn): Promise<Position[] | null> {
  const fn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const url = "/api/okx/api/v5/account/positions";
  try {
    const res = await fn(url);
    if (!res.ok) return null;
    const raw = await res.json();
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    // Direkt OKX response veya proxy wrap
    if (typeof r.code === "string") {
      return parsePositionResponse(raw);
    }
    if (r.data && typeof r.data === "object") {
      return parsePositionResponse(r.data);
    }
    return null;
  } catch {
    return null;
  }
}
