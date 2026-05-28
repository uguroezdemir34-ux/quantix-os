"use client";

/**
 * REASONS LIST — Skor pipeline açıklamaları.
 *
 * Meta açıklamaları (regime, sweep, pullback, vs.) iconlu liste olarak gösterir.
 */

import { useT } from "@/lib/i18n/context";
import type { ScoreReasons } from "@/lib/score/orchestrator";

const META_FIELDS: Array<{
  key: keyof ScoreReasons;
  labelKey: string;
  icon: string;
}> = [
  { key: "regime", labelKey: "reasons.regime", icon: "🌐" },
  { key: "regimeRelax", labelKey: "reasons.regimeRelax", icon: "🔓" },
  { key: "atrRegime", labelKey: "reasons.atrRegime", icon: "📊" },
  { key: "sweep", labelKey: "reasons.sweep", icon: "🌊" },
  { key: "volBreakout", labelKey: "reasons.volBreakout", icon: "💥" },
  { key: "drawdownGate", labelKey: "reasons.drawdownGate", icon: "🛑" },
  { key: "adaptiveCut", labelKey: "reasons.adaptiveCut", icon: "✂️" },
  { key: "lockRamp", labelKey: "reasons.lockRamp", icon: "⏱" },
  { key: "pullback", labelKey: "reasons.pullback", icon: "🔄" },
  { key: "pullbackThreshold", labelKey: "reasons.pullbackThreshold", icon: "🎯" },
];

export function ReasonsList({
  reasons,
}: {
  reasons: ScoreReasons;
}): React.ReactElement | null {
  const t = useT();
  const activeFields = META_FIELDS.filter((f) => reasons[f.key]);
  if (activeFields.length === 0) return null;

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t3 mb-3 font-mono text-2xs tracking-widest">
        {t("reasons.title")}
      </h3>
      <div className="space-y-2">
        {activeFields.map((f) => (
          <div key={f.key} className="flex items-start gap-2 text-xs leading-relaxed">
            <span className="shrink-0">{f.icon}</span>
            <span className="text-text-t3 w-20 shrink-0 font-mono text-2xs tracking-wider">
              {t(f.labelKey).toUpperCase()}
            </span>
            <span className="text-text-t2 flex-1">{reasons[f.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
