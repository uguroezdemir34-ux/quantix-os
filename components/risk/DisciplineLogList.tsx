"use client";

/**
 * DISCIPLINE LOG LIST — Son N gün event listesi.
 *
 * Her event satırı: timestamp + type icon + label + optional detail.
 */

import { useMemo, useState } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { formatTime } from "@/lib/i18n/format";
import { useRiskStore } from "@/lib/store/riskStore";
import type { DisciplineEntry, DisciplineEventType } from "@/lib/risk/discipline-log";

const TYPE_ICONS: Record<string, string> = {
  verdict_go: "🟢",
  verdict_no: "🟡",
  trade_open: "▶",
  trade_close: "⏹",
  system_against: "⚠",
  system_with: "✓",
  rule_violation: "✗",
  cooldown_triggered: "⏸",
  lock_released: "🔓",
};

const TYPE_COLORS: Record<string, string> = {
  verdict_go: "text-signal-green",
  verdict_no: "text-signal-amber",
  trade_open: "text-text-t1",
  trade_close: "text-text-t1",
  system_against: "text-signal-red",
  system_with: "text-signal-green",
  rule_violation: "text-signal-red",
  cooldown_triggered: "text-signal-amber",
  lock_released: "text-signal-green",
};

export function DisciplineLogList(): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);

  const recent = useRiskStore((s) => s.disciplineEntries);
  const all = recent;
  const clearLog = useRiskStore((s) => s.clearLog);

  const displayed = useMemo(() => {
    if (showAll) return all;
    const cutoff = Date.now() - 7 * 86400_000;
    return recent.filter((e) => e.ts >= cutoff);
  }, [showAll, recent, all]);

  // En yeni üstte
  const sorted = useMemo(
    () => [...displayed].sort((a, b) => b.ts - a.ts),
    [displayed],
  );

  const handleClear = () => {
    if (confirm(t("risk.log.clearConfirm"))) {
      clearLog();
    }
  };

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-text-t1 font-mono text-xs tracking-widest">
          {t("risk.log.title")}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-text-t3 hover:text-text-t1 font-mono text-2xs tracking-wider"
          >
            {showAll ? t("risk.log.showRecent") : t("risk.log.showAll")}
          </button>
          {all.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="text-signal-red hover:text-signal-red/70 font-mono text-2xs tracking-wider"
            >
              {t("risk.log.clearAll")}
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-text-t4 py-4 text-center font-mono text-2xs tracking-wider">
          {t("risk.log.empty")}
        </div>
      ) : (
        <ul className="max-h-96 space-y-1 overflow-y-auto">
          {sorted.map((e, i) => (
            <LogRow key={`${e.ts}-${i}`} entry={e} locale={locale} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LogRow({
  entry,
  locale,
  t,
}: {
  entry: DisciplineEntry;
  locale: "en" | "tr";
  t: (key: string) => string;
}): React.ReactElement {
  const type = entry.type as DisciplineEventType;
  const icon = TYPE_ICONS[type] ?? "•";
  const color = TYPE_COLORS[type] ?? "text-text-t2";
  const labelKey = `risk.log.${type}`;
  const label = t(labelKey);

  // Extra detayları derle
  const details: string[] = [];
  if (entry.pair && typeof entry.pair === "string") details.push(entry.pair);
  if (entry.direction && typeof entry.direction === "string")
    details.push(entry.direction);
  if (typeof entry.score === "number") details.push(`${entry.score}/100`);
  if (typeof entry.pnl === "number") {
    details.push(`${entry.pnl >= 0 ? "+" : ""}$${entry.pnl.toFixed(2)}`);
  }
  if (entry.reason && typeof entry.reason === "string")
    details.push(entry.reason);

  return (
    <li className="border-border/30 flex items-start gap-2 border-b py-1.5 text-xs last:border-0">
      <span className={`mt-0.5 shrink-0 ${color}`}>{icon}</span>
      <div className="flex-1 truncate">
        <span className={`font-mono ${color}`}>{label}</span>
        {details.length > 0 && (
          <span className="text-text-t3 ml-1 font-mono text-2xs">
            · {details.join(" · ")}
          </span>
        )}
      </div>
      <span className="text-text-t4 shrink-0 font-mono text-2xs tabular-nums">
        {formatTime(entry.ts, locale)}
      </span>
    </li>
  );
}
