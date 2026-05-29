import type { Pair } from "@/lib/constants/pairs";

export function pairToInstId(pair: Pair): string {
  return `${pair}-USDT-SWAP`;
}
