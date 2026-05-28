"use client";

/**
 * VERDICT BADGE — GO / WAIT / NO.
 * Büyük renkli pill, karar verici göstergesi.
 */

import { useT } from "@/lib/i18n/context";

type Verdict = "go" | "wait" | "no";

export function VerdictBadge({
  verdict,
  signalType,
}: {
  verdict: Verdict;
  signalType?: "classic" | "pullback";
}): React.ReactElement {
  const t = useT();
  const styles = {
    go: { cls: "bg-signal-green text-bg", labelKey: "verdict.go", icon: "✓" },
    wait: { cls: "bg-signal-amber text-bg", labelKey: "verdict.wait", icon: "⏸" },
    no: { cls: "bg-signal-red text-bg", labelKey: "verdict.no", icon: "✕" },
  } as const;
  const s = styles[verdict];
  return (
    <div className="flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-sm font-bold tracking-widest ${s.cls}`}
      >
        <span>{s.icon}</span>
        <span>{t(s.labelKey)}</span>
      </div>
      {signalType === "pullback" && (
        <span className="bg-soft-amber text-signal-amber rounded px-2 py-0.5 font-mono text-2xs tracking-wider">
          {t("verdict.pullback")}
        </span>
      )}
    </div>
  );
}
