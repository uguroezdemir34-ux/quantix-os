import type { Pair } from "@/lib/constants/pairs";

export interface OpenPositionInput {
  pair: Pair;
  direction: "LONG" | "SHORT";
  qty: number;
  leverage: number;
  marginMode: "cross" | "isolated";
}

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

export interface ExchangeAdapter {
  openPosition(input: OpenPositionInput): Promise<AdapterResult<TradeData>>;
}
