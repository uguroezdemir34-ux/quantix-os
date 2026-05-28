"use client";

/**
 * SCORE BAR — Toplam skor (0-100) çubuğu.
 *
 * Görsel: yatay bar, eşik çizgisi (effectiveThreshold).
 * Renk: skor < 65 kırmızı, 65-eşik amber, eşik+ yeşil.
 */

import { useT } from "@/lib/i18n/context";

export function ScoreBar({
  score,
  threshold,
  goThreshold,
}: {
  score: number;
  threshold: number;
  goThreshold: number;
}): React.ReactElement {
  const t = useT();
  const clamped = Math.max(0, Math.min(100, score));
  const tColor =
    score >= threshold
      ? "bg-signal-green"
      : score >= 65
        ? "bg-signal-amber"
        : "bg-signal-red";
  const thresholdPct = Math.max(0, Math.min(100, threshold));
  const classicPct = Math.max(0, Math.min(100, goThreshold));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-text-t1 font-mono text-4xl font-bold tabular-nums">
            {clamped}
          </span>
          <span className="text-text-t3 ml-1 font-mono text-base">/ 100</span>
        </div>
        <div className="text-text-t3 font-mono text-xs tracking-wider">
          {t("score.threshold")} · {threshold}
          {threshold !== goThreshold && (
            <span className="text-text-t4 ml-1">
              ({t("score.classic")} {goThreshold})
            </span>
          )}
        </div>
      </div>
      {/* Bar */}
      <div className="bg-border relative h-3 overflow-hidden rounded">
        <div
          className={`h-full transition-all ${tColor}`}
          style={{ width: `${clamped}%` }}
        />
        {/* Threshold marker (efektif eşik) */}
        <div
          className="absolute top-0 h-full w-0.5 bg-white/70"
          style={{ left: `${thresholdPct}%` }}
          title={`${t("score.threshold")}: ${threshold}`}
        />
        {/* Klasik threshold marker (pullback aktifse) */}
        {threshold !== goThreshold && (
          <div
            className="absolute top-0 h-full w-0.5 bg-white/30"
            style={{ left: `${classicPct}%` }}
            title={`${t("score.classic")}: ${goThreshold}`}
          />
        )}
      </div>
      {/* Açıklayıcı işaretler */}
      <div className="text-text-t4 flex justify-between font-mono text-2xs tracking-wider">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}
