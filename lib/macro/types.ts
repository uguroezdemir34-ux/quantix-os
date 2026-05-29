/**
 * MACRO & REGIME — Tip tanımları.
 * Kaynak: panel_v55_51.html satır 7131-7159 (fetchFG/fetchBtcDom) +
 *         8395-8473 (renderMarketView içinde sentez mantığı).
 *
 * 4 katman:
 *   - Saf fonksiyonlar (etiket + faz hesabı, test edilebilir)
 *   - In-memory cache (TTL 30dk)
 *   - HTTP fetch (4sn timeout, hata toleransı)
 *   - Next.js API route (server-side proxy)
 */

/** F&G etiket kategorileri (panel 8411-8416) */
export type FgLabel =
  | "AŞIRI KORKU" // < 25
  | "KORKU" // < 45
  | "NÖTR" // < 55
  | "AÇGÖZLÜ" // < 75
  | "AŞIRI AÇGÖZLÜ"; // ≥ 75

/** F&G CSS sınıfı (UI için) */
export type FgClass =
  | "fear"
  | "caution"
  | "neutral"
  | "greed"
  | "extreme-greed";

export interface FgInfo {
  /** F&G değeri 0-100 */
  value: number;
  /** Kategori etiketi (Türkçe) */
  label: FgLabel;
  /** UI rengi/sınıfı için */
  cssClass: FgClass;
}

/** Dominance faz tipi (panel 8430-8443) */
export type DominancePhase =
  | "risk_off_usdt" // Risk-Off · USDT'ye kaçış (usdtD ≥ 5.5)
  | "btc_trend" // BTC ağırlıklı trend (btcD ≥ 55, usdtD < 5)
  | "altcoin_season" // Altcoin sezonu sinyali (btcD < 50, usdtD < 5)
  | "mixed" // Karma piyasa
  | "no_data"; // Veri yok

export interface DominanceInfo {
  /** BTC dominance % */
  btcD: number;
  /** USDT dominance % */
  usdtD: number;
  /** Faz kategorisi */
  phase: DominancePhase;
  /** İnsan-okunur Türkçe açıklama */
  label: string;
}

/** Piyasa özet sentezi (panel 8447-8473) */
export type MarketSummaryClass =
  | "risk_on_caution" // Aşırı iyimserlik (zirve riski)
  | "risk_off" // Korku/USDT'ye kaçış
  | "risk_on_healthy" // Sağlıklı iştah
  | "neutral" // Nötr piyasa
  | "undecided"; // Piyasa kararsız

export interface MarketSummary {
  /** Sentez sınıfı */
  cls: MarketSummaryClass;
  /** İkon (emoji) */
  icon: string;
  /** Türkçe açıklama */
  text: string;
}

/** fetchFearGreed sonucu */
export interface FearGreedResult {
  value: number;
  /** Veri çekilme zamanı (epoch ms) */
  fetchedAt: number;
  /** API'den mi cache'den mi geldi? */
  source: "api" | "cache" | "fallback";
}

/** fetchBtcDominance sonucu */
export interface DominanceResult {
  btcD: number;
  usdtD: number;
  fetchedAt: number;
  source: "api" | "cache" | "fallback";
}

/** Cache TTL ve timeout sabitleri */
export const MACRO_CONSTANTS = {
  /** F&G cache TTL — F&G günde 1 değişir, 30dk yeterli */
  FG_CACHE_TTL_MS: 30 * 60_000,
  /** Dominance cache TTL — dakikalar mertebesinde değişir */
  DOM_CACHE_TTL_MS: 30 * 60_000,
  /** HTTP fetch timeout */
  FETCH_TIMEOUT_MS: 4_000,
  /** F&G fallback (servis erişilemezse) */
  FG_FALLBACK: 50,
  /** Dominance fallback (servis erişilemezse) — 0 değer kullanılmaz */
  DOM_BTC_FALLBACK: 0,
  DOM_USDT_FALLBACK: 0,
  /** F&G eşikleri (panel 8411-8416) */
  FG_THRESHOLD_FEAR: 25,
  FG_THRESHOLD_CAUTION: 45,
  FG_THRESHOLD_NEUTRAL: 55,
  FG_THRESHOLD_GREED: 75,
  /** Dominance eşikleri (panel 8434-8442) */
  USDT_HIGH: 5.5,
  USDT_HEALTHY_MAX: 5.0,
  BTC_DOMINANT_MIN: 55,
  BTC_DOMINANT_MAX: 50,
  /** Market summary eşikleri (panel 8454-8468) */
  USDT_EXTREME: 5.8,
  USDT_HEALTHY_RISK_ON: 5.5,
} as const;
