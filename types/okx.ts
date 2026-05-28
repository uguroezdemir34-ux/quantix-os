/**
 * OKX response tipleri — v55.51 panel kullanım kalıbından çıkarıldı.
 * SADECE trailing modülünün ihtiyaç duyduğu alanlar burada.
 * Tam OKX tip seti Faz 1b paket #3'te (OKX katmanı) gelecek.
 */

/**
 * OKX pozisyon objesi (positions endpoint).
 * Panel `ST.positions` array'inin elemanı.
 */
export interface OkxPosition {
  instId: string;
  posSide: "long" | "short" | "net";
  /** Pozisyon büyüklüğü, negatif olabilir (net mode) */
  pos: string;
  /** Ortalama giriş fiyatı */
  avgPx: string;
  /** Mark price */
  markPx?: string;
  /** Son fiyat (fallback) */
  last?: string;
  /** Margin mode */
  mgnMode?: "cross" | "isolated";

  // Panel'in eklediği custom alanlar (UI için)
  _panelTrailingStop?: number;
  _panelTrailingCarpan?: number;
}

/**
 * OKX kline (mum) — getKlines() döner.
 * Format: panel ile birebir.
 */
export interface OkxKline {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * OKX API yanıt sarmalayıcı (panel `okxFetch`/`okxPost`'ın döndürdüğü şekil).
 */
export interface OkxApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  err?: string;
}

/**
 * close-position endpoint payload'ı.
 */
export interface ClosePositionRequest {
  instId: string;
  mgnMode: "cross" | "isolated";
  posSide?: "long" | "short";
  autoCxl?: boolean;
  ccy?: string;
}
