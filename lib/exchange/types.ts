import type { Pair } from "@/lib/constants/pairs";

// ═══════════════ INPUT TYPES ═══════════════

export interface OpenPositionInput {
  pair: Pair;
  direction: "LONG" | "SHORT";
  qty: number;
  leverage: number;
  marginMode: "cross" | "isolated";
  /** SL trigger fiyatı (algo order) */
  slPrice?: number;
  /** TP1 trigger fiyatı (algo order) */
  tp1Price?: number;
  /** TP2 trigger fiyatı — opsiyonel */
  tp2Price?: number;
  /**
   * Slippage guard tarafından belirlenen emir tipi.
   * Varsayılan: "market" (geriye dönük uyumlu).
   */
  ordType?: "market" | "limit" | "post_only";
  /**
   * Limit / Post-Only emirler için fiyat.
   * ordType="market" ise ignored.
   */
  limitPx?: number;
}

export interface ClosePositionInput {
  instId: string;
  mgnMode: "cross" | "isolated";
  posSide?: "long" | "short";
}

// ═══════════════ RESULT TYPES ═══════════════

export interface TradeData {
  orderId?: string;
  instId?: string;
  fillPx?: number;
  fillSz?: number;
}

export interface AdapterResult<T = unknown> {
  ok: boolean;
  data?: T;
  errorKind?: string;
  errorMessage?: string;
}

// ═══════════════ ADAPTER INTERFACE ═══════════════

/**
 * ExchangeAdapter — borsa işlemleri için DI arayüzü.
 * Gerçek impl: OkxAdapter. Test: MockAdapter.
 */
export interface ExchangeAdapter {
  /** Market order ile pozisyon aç (+ SL/TP algo emirleri) */
  openPosition(input: OpenPositionInput): Promise<AdapterResult<TradeData>>;
  /** Pozisyonu market order ile kapat */
  closePosition(input: ClosePositionInput): Promise<AdapterResult<void>>;
  /** Bekleyen algo emirlerini (SL/TP) iptal et */
  cancelAlgoOrders(instId: string): Promise<AdapterResult<void>>;
}
