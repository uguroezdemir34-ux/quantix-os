"use client";

/**
 * BRAND HEADER — AppHeader içinde marka kimliği bloğu.
 *
 * Yapı (mobile-first, v3):
 *   [logo] QUANTIX OS v3
 *          Flow Intelligence
 *
 * Logo: SM boyut (20px), inline yanında metin.
 * OS etiketi: brand color (turuncu) ile vurgulanır (premium hissi).
 */

import { QuantixLogo } from "./QuantixLogo";
import { BRAND } from "@/lib/brand";

interface Props {
  /** Compact: sadece logo + isim. Default: false → tagline da var */
  compact?: boolean;
}

export function BrandHeader({ compact = false }: Props): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <QuantixLogo size="sm" />
      <div className="flex flex-col leading-tight">
        <div className="flex items-baseline gap-1">
          <span className="text-text-t1 font-mono text-sm font-semibold tracking-widest">
            {BRAND.name}
          </span>
          <span className="text-brand font-mono text-2xs font-bold tracking-widest">
            {BRAND.system}
          </span>
          <span className="text-text-t3 font-mono text-2xs font-semibold tracking-widest">
            {BRAND.version}
          </span>
        </div>
        {!compact && (
          <span className="text-text-t3 font-mono text-2xs tracking-wider">
            {BRAND.taglineShort}
          </span>
        )}
      </div>
    </div>
  );
}
