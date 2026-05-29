export const PAIRS = ["BTC", "ETH"] as const;
export type Pair = typeof PAIRS[number];
