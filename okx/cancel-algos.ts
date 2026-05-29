/**
 * OKX cancel-algos helper — v55.51 panel ile birebir.
 * Kaynak: panel_v55_51.html satır 11164-11197.
 *
 * KRİTİK NOT: OKX V5 /orders-algo-pending endpoint'i `ordType` parametresini
 * ZORUNLU kılar. Tek istekle tüm tipleri çekemezsin. Panel deneyimiyle 4 tip
 * tek tek sorgulanır: conditional, oco, trigger, move_order_stop.
 *
 * Bu fonksiyon OKX HTTP katmanına bağımlı (`okxFetch`/`okxPost`). Henüz
 * port edilmedi (Faz 1b paket #3). Burada SADECE iş mantığı + DI interface
 * tanımlanır. Browser'a bağlanma noktası paket #3'te.
 */

import type { OkxApiResponse } from "@/types/okx";

export interface AlgoOrder {
  algoId: string;
  instId: string;
}

export type OrdType = "conditional" | "oco" | "trigger" | "move_order_stop";
export const ALGO_ORD_TYPES: readonly OrdType[] = [
  "conditional",
  "oco",
  "trigger",
  "move_order_stop",
];

/**
 * OKX HTTP bağımlılıkları — Faz 1b paket #3'te gerçek implementation gelir.
 */
export interface OkxClient {
  fetch(path: string): Promise<OkxApiResponse<AlgoOrder[]>>;
  post(
    path: string,
    body: AlgoOrder[],
  ): Promise<OkxApiResponse<unknown>>;
}

/**
 * Bir instId için tüm bekleyen algo emirlerini iptal et.
 * Panel `_cancelAlgoOrders` ile birebir akış.
 *
 * @returns true = iptal başarılı (veya iptal edilecek emir yoktu)
 *          false = en az bir hata oldu
 */
export async function cancelAlgoOrders(
  instId: string,
  client: OkxClient,
): Promise<boolean> {
  const collected: AlgoOrder[] = [];

  try {
    for (const ordType of ALGO_ORD_TYPES) {
      const r = await client.fetch(
        `/api/v5/trade/orders-algo-pending?ordType=${ordType}&instId=${instId}`,
      );
      if (!r.ok || !Array.isArray(r.data)) continue;
      for (const o of r.data) {
        if (o.instId === instId && o.algoId) {
          collected.push({ algoId: o.algoId, instId: o.instId });
        }
      }
    }

    if (collected.length === 0) {
      return true; // iptal edilecek bir şey yok — başarı
    }

    const c = await client.post("/api/v5/trade/cancel-algos", collected);
    return c.ok;
  } catch {
    return false;
  }
}
