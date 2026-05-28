/**
 * OHLCV mum verisi — v55.51 panel ile birebir aynı şema.
 * Panel JS'de { o, h, l, c, v, t } kullanılıyor — VWAP timestamp için 't' okuyor.
 */
export interface Candle {
  /** Open */
  o: number;
  /** High */
  h: number;
  /** Low */
  l: number;
  /** Close */
  c: number;
  /** Volume */
  v: number;
  /** Timestamp (ms) — panel VWAP() bu alanı kullanır */
  t?: number;
}

export type Closes = readonly number[];

export function toCloses(candles: readonly Candle[]): number[] {
  return candles.map((k) => k.c);
}
