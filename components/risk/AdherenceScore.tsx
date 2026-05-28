"use client";

/**
 * ADHERENCE SCORE — Sistem uyumu skoru dial'ı.
 *
 * 0-100 skor + tier renk + breakdown sayıları.
 */

import { useT } from "@/lib/i18n/context";
import { useRiskStore } from "@/lib/store/riskStore";
import { computeAdherenceScore } from "@/lib/risk/adherence-score";

const TIER_COLORS = {
  excellent: "text-signal-green border-signal-green/40 bg-soft-green",
  good: "text-signal-green border-signal-green/30 bg-soft-green/60",
  fair: "text-signal-amber border-signal-amber/40 bg-soft-amber",
  poor: "text-signal-red border-signal-red/40 bg-soft-red/70",
  critical: "text-signal-red border-signal-red/60 bg-soft-red",
} as const;

export function AdherenceScore(): React.ReactElement {
  const t = useT();
  const entries = useRiskStore((s) => s.disciplineEntries);
  const result = computeAdherenceScore(entries);
  const tierLabel = t(`risk.adherence.tier.${result.tier}`);
  const cls = TIER_COLORS[result.tier];

  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <h3 className="mb-2 font-mono text-xs tracking-widest">
        {t("risk.adherence.title")}
      </h3>
      <p className="text-text-t3 mb-3 text-xs leading-relaxed">
        {t("risk.adherence.description")}
      </p>

      {/* Score + tier */}
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <span className="font-mono text-4xl font-bold tabular-nums">
            {result.score}
          </span>
          <span className="text-text-t3 ml-1 font-mono text-base">/ 100</span>
        </div>
        <span className="font-mono text-sm font-bold uppercase tracking-widest">
          {tierLabel}
        </span>
      </div>

      {/* Score bar */}
      <div className="bg-border mb-3 h-2 overflow-hidden rounded">
        <div
          className={`h-full transition-all ${
            result.tier === "excellent" || result.tier === "good"
              ? "bg-signal-green"
              : result.tier === "fair"
                ? "bg-signal-amber"
                : "bg-signal-red"
          }`}
          style={{ width: `${result.score}%` }}
        />
      </div>

      {/* Breakdown */}
      <div className="text-text-t2 grid grid-cols-3 gap-2 font-mono text-2xs tracking-wider">
        <Stat
          label={t("risk.adherence.withSystem")}
          value={result.withSystem}
          color="text-signal-green"
        />
        <Stat
          label={t("risk.adherence.againstSystem")}
          value={result.againstSystem}
          color="text-signal-red"
        />
        <Stat
          label={t("risk.adherence.ruleViolation")}
          value={result.ruleViolation}
          color="text-signal-red"
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className={`font-mono text-lg font-bold tabular-nums ${color}`}>
        {value}
      </div>
      <div className="text-text-t4 leading-tight">{label}</div>
    </div>
  );
}
