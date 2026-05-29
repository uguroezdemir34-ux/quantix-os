/**
 * BRAND CONSTANTS — Tek doğruluk kaynağı.
 *
 * Marka kimliği değişiklikleri tek yerden:
 *   - Logo bileşenleri buradan renkleri okur
 *   - Favicon / OG image SVG'leri bu renkleri kullanır
 *   - Layout metadata tagline buradan
 *
 * Logo görsel kimliği: metalik gümüş boğa + mavi devre + turuncu kristal.
 * Şu an SVG placeholder kullanıyoruz; kullanıcı dilerse public/quantix-logo.svg
 * dosyasını kendi profesyonel logo ile değiştirebilir.
 */

export const BRAND = {
  /** Marka adı (alfabetik, all-caps) */
  name: "QUANTIX",
  /** Sistem etiketi (v3 OS) */
  system: "OS",
  /** Açıklama / tagline */
  tagline: "Flow Intelligence Trading System",
  /** Tagline kısa (mobile başlık altı) */
  taglineShort: "Flow Intelligence",
  /** Versiyon etiketi */
  version: "v3",
} as const;

/**
 * Marka renkleri (3 ana renk).
 * Tailwind config ile senkron — değiştirilecekse her ikisi de güncellenmeli.
 */
export const BRAND_COLORS = {
  /** Boğa rengi: metalik gümüş */
  silver: "#C0C5CC",
  silverDark: "#8A8F96",
  silverLight: "#E5E7EB",

  /** Devre rengi: koyu metalik mavi */
  circuit: "#1E40AF",
  circuitGlow: "#3B82F6",

  /** Kristal rengi: turuncu (mevcut brand renk ile uyumlu) */
  crystal: "#FF6B1A",
  crystalGlow: "#FFB300",
} as const;

/**
 * SEO meta description.
 */
export const BRAND_META = {
  title: `${BRAND.name} ${BRAND.system} — ${BRAND.tagline}`,
  description:
    "Disciplined, AI-powered crypto futures trading panel with institutional-grade order flow intelligence (CVD, VPIN, Smart Money Concepts), automated decision system, and integrated risk protocols.",
  keywords: [
    "crypto trading",
    "futures",
    "order flow",
    "VPIN",
    "smart money concepts",
    "CVD",
    "AI trading",
    "BTC",
    "ETH",
    "OKX",
    "risk management",
  ].join(", "),
} as const;
