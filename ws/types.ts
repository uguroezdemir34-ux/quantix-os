/**
 * WS TYPES — Real-time market data tipleri.
 * Kaynak: panel_v55_51.html satır 6075-6225 (OKX + Binance WS handling).
 */

import type { Pair } from "@/lib/constants/pairs";

/** Tek bir fiyat tick'i (OKX veya Binance'dan parse edilmiş hali) */
export interface Tick {
  pair: Pair;
  /** Son fiyat */
  last: number;
  /** 24 saatlik açılış (chg % hesabı için) */
  open24h: number;
  /** % değişim (chg) */
  chg: number;
  /** Tick alındı zamanı (epoch ms) */
  ts: number;
  /** Hangi kanaldan geldi: 'ticker' (snapshot) veya 'trade' (gerçek alım) */
  source: "ticker" | "trade";
}

/** WS endpoint konfigürasyonu */
export interface WsEndpoint {
  url: string;
  type: "okx" | "binance";
  /** Bağlanma sonrası subscribe mesajı (OKX için) */
  subscribeMessage?: object;
}

/** Connection status — UI rozeti için */
export type ConnectionStatus =
  | "idle" // Henüz başlamadı
  | "connecting" // WebSocket açılıyor
  | "connected" // Açık ve veri akıyor
  | "silent" // Açık ama 5 saniyedir tick yok (carrier filter şüphesi)
  | "disconnected" // Kapalı, reconnect timer'ı bekliyor
  | "destroyed"; // Kullanıcı manuel kapadı, yeniden bağlanma yok

/** Bağlantı durumu detayları */
export interface ConnectionState {
  status: ConnectionStatus;
  /** Şu an aktif URL (debug için) */
  currentUrl: string | null;
  /** Şu an aktif tip (OKX/Binance) */
  currentType: "okx" | "binance" | null;
  /** Toplam reconnect sayısı (bu session) */
  retries: number;
  /** Son tick alındığı zaman (silence watchdog) */
  lastTickAt: number;
  /** Bağlantı kuruldu zamanı */
  connectedAt: number | null;
}

/** WS sabitleri */
export const WS_CONSTANTS = {
  /** Silence watchdog süresi — bu kadar süre tick gelmezse sessiz say */
  SILENCE_TIMEOUT_MS: 5_000,
  /** Silence watchdog kontrol periyodu */
  SILENCE_CHECK_MS: 1_000,
  /** OKX ping periyodu (default 25s) */
  OKX_PING_INTERVAL_MS: 25_000,
  /** İlk N retry hızlı (her URL'i dene) */
  FAST_RETRY_COUNT: 4,
  /** Hızlı retry delay */
  FAST_RETRY_DELAY_MS: 2_000,
  /** Yavaş retry base delay */
  SLOW_RETRY_BASE_MS: 3_000,
  /** Maks reconnect delay */
  MAX_RECONNECT_MS: 30_000,
  /** Exponential backoff factor */
  BACKOFF_FACTOR: 1.5,
  /** Maks exponential adım */
  MAX_BACKOFF_STEPS: 8,
} as const;
