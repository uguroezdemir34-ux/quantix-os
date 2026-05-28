"use client";

/**
 * QUANTIX LOGO — SVG inline render (Next/Image kullanmıyoruz: tek dosya tutarlı).
 *
 * 3 boyut variant:
 *   - sm: 20×20 (header için)
 *   - md: 40×40 (kart başlığı için)
 *   - lg: 120×120 (splash veya about için)
 *
 * Logo dosyası: public/quantix-logo.svg.
 * Kullanıcı kendi dosyasını yüklerse buradan otomatik beslenir.
 */

interface Props {
  size?: "sm" | "md" | "lg";
  /** alt text (a11y) */
  alt?: string;
  /** Ekstra className (örn. opacity, animasyon) */
  className?: string;
}

const SIZES = {
  sm: 20,
  md: 40,
  lg: 120,
} as const;

export function QuantixLogo({
  size = "md",
  alt = "QUANTIX",
  className = "",
}: Props): React.ReactElement {
  const px = SIZES[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/quantix-logo.svg"
      alt={alt}
      width={px}
      height={px}
      className={`inline-block ${className}`}
      style={{ width: px, height: px }}
    />
  );
}
