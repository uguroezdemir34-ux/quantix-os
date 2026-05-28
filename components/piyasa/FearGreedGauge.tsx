"use client";

/**
 * FEAR & GREED GAUGE — Yarım daire göstergesi 0-100.
 *
 * SVG ile basit gauge:
 *   - Arka plan: gri yarım daire
 *   - Üzerinde: değere göre dolan renkli arc
 *   - Ortada: büyük sayı + etiket
 */

import { useT } from "@/lib/i18n/context";
import type { FgInfo } from "@/lib/macro/types";

interface Props {
  info: FgInfo | null;
  loading?: boolean;
}

const COLOR_BY_CLASS = {
  fear: "#ef4444", // signal-red
  caution: "#f59e0b", // signal-amber
  neutral: "#a3a3a3", // neutral gray
  greed: "#22c55e", // signal-green
  "extreme-greed": "#16a34a", // darker green
} as const;

const CLASS_TO_I18N = {
  fear: "extreme_fear",
  caution: "fear",
  neutral: "neutral",
  greed: "greed",
  "extreme-greed": "extreme_greed",
} as const;

export function FearGreedGauge({ info, loading }: Props): React.ReactElement {
  const t = useT();

  if (!info && loading) {
    return (
      <div className="border-border bg-bg-card h-48 animate-pulse rounded-lg border" />
    );
  }

  if (!info) {
    return (
      <div className="border-border bg-bg-card rounded-lg border p-4">
        <h3 className="text-text-t1 font-mono text-xs tracking-widest">
          {t("piyasa.fg.title")}
        </h3>
        <p className="text-text-t3 mt-2 text-xs">—</p>
      </div>
    );
  }

  const value = info.value;
  const color = COLOR_BY_CLASS[info.cssClass];
  const labelKey = CLASS_TO_I18N[info.cssClass];
  const label = t(`piyasa.fg.label.${labelKey}`);

  // Yarım daire path için arc hesabı (0° = sol, 180° = sağ)
  // Center: (100, 100), radius: 80
  const angle = (value / 100) * 180; // 0..180 derece
  const radians = (angle - 180) * (Math.PI / 180);
  const x = 100 + 80 * Math.cos(radians);
  const y = 100 + 80 * Math.sin(radians);
  const largeArc = angle > 90 ? 1 : 0;

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t1 mb-3 font-mono text-xs tracking-widest">
        {t("piyasa.fg.title")}
      </h3>

      <div className="relative mx-auto" style={{ maxWidth: "240px" }}>
        <svg viewBox="0 0 200 120" className="w-full">
          {/* Arka yarım daire (gri zemin) */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            stroke="currentColor"
            strokeOpacity="0.15"
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
          />
          {/* Renkli arc (dolan) */}
          <path
            d={`M 20 100 A 80 80 0 ${largeArc} 1 ${x} ${y}`}
            stroke={color}
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
          />
          {/* Değer (büyük) */}
          <text
            x="100"
            y="92"
            textAnchor="middle"
            className="fill-current"
            fontSize="36"
            fontWeight="bold"
            fontFamily="ui-monospace, monospace"
          >
            {value}
          </text>
        </svg>
      </div>

      {/* Etiket */}
      <div
        className="mt-2 text-center font-mono text-sm font-bold tracking-widest"
        style={{ color }}
      >
        {label.toUpperCase()}
      </div>
    </div>
  );
}
