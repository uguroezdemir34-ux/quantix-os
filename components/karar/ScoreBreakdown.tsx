"use client";

/**
 * SCORE BREAKDOWN — 8 kategori puanlarının küçük çubuk grafiği.
 *
 * Panel mantığıyla: trend, adx, rsi, vol, bb, vwap, funding, macro.
 */

import { useT } from "@/lib/i18n/context";
import type { ScoreSubScores, ScoreReasons } from "@/lib/score/orchestrator";

const CATEGORIES: Array<{
  key: keyof ScoreSubScores;
  labelKey: string;
  max: number;
}> = [
  { key: "trend", labelKey: "score.categories.trend", max: 25 },
  { key: "adx", labelKey: "score.categories.adx", max: 12 },
  { key: "rsi", labelKey: "score.categories.rsi", max: 12 },
  { key: "vol", labelKey: "score.categories.vol", max: 8 },
  { key: "bb", labelKey: "score.categories.bb", max: 8 },
  { key: "vwap", labelKey: "score.categories.vwap", max: 10 },
  { key: "funding", labelKey: "score.categories.funding", max: 5 },
  { key: "macro", labelKey: "score.categories.macro", max: 8 },
];

export function ScoreBreakdown({
  sub,
  reasons,
}: {
  sub: ScoreSubScores;
  reasons: ScoreReasons;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t3 mb-3 font-mono text-2xs tracking-widest">
        {t("score.categories.title")}
      </h3>
      <div className="space-y-2">
        {CATEGORIES.map((cat) => {
          const val = sub[cat.key];
          const pct = (val / cat.max) * 100;
          const label = t(cat.labelKey);
          return (
            <div key={cat.key} className="flex items-center gap-3">
              <div className="text-text-t2 w-14 font-mono text-2xs tracking-wider">
                {label.toUpperCase()}
              </div>
              <div className="bg-border relative h-2 flex-1 overflow-hidden rounded">
                <div
                  className="bg-brand h-full transition-all"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="text-text-t1 w-10 text-right font-mono text-xs tabular-nums">
                {val}
                <span className="text-text-t4">/{cat.max}</span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Açıklamalar */}
      <div className="border-border mt-4 space-y-1 border-t pt-3 text-2xs leading-relaxed">
        {CATEGORIES.map((cat) => {
          const reason = reasons[cat.key as keyof ScoreReasons];
          if (!reason) return null;
          const label = t(cat.labelKey);
          return (
            <div key={cat.key} className="flex gap-2">
              <span className="text-text-t4 w-14 shrink-0 font-mono tracking-wider">
                {label.toLowerCase()}
              </span>
              <span className="text-text-t2">{reason}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
