"use client";

/**
 * DIRECTION BADGE — LONG / SHORT / NEUTRAL rozeti.
 */

import { useT } from "@/lib/i18n/context";
import type { Direction } from "@/lib/score/orchestrator";

const KEYS: Record<Direction, string> = {
  LONG: "direction.long",
  SHORT: "direction.short",
  NEUTRAL: "direction.neutral",
};

export function DirectionBadge({
  direction,
  confidence,
}: {
  direction: Direction;
  confidence: number;
}): React.ReactElement {
  const t = useT();
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";
  const cls = isLong
    ? "bg-soft-green text-signal-green border-signal-green/40"
    : isShort
      ? "bg-soft-red text-signal-red border-signal-red/40"
      : "bg-border text-text-t2 border-border-strong";
  const icon = isLong ? "▲" : isShort ? "▼" : "◆";
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs font-semibold tracking-wider ${cls}`}
    >
      <span className="leading-none">{icon}</span>
      <span>{t(KEYS[direction])}</span>
      {confidence > 0 && (
        <span className="opacity-70">·{(confidence * 100).toFixed(0)}%</span>
      )}
    </div>
  );
}
