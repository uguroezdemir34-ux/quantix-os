"use client";

/**
 * MARKET SUMMARY BANNER — F&G + Dominance sentezi.
 *
 * Üst banner — sayfanın en üstünde geniş bir kart.
 */

import { useT } from "@/lib/i18n/context";
import type {
  MarketSummary,
  MarketSummaryClass,
} from "@/lib/macro/types";

interface Props {
  summary: MarketSummary | null;
}

const CLS_BG: Record<MarketSummaryClass, string> = {
  risk_on_caution: "bg-soft-amber border-signal-amber/40",
  risk_off: "bg-soft-red border-signal-red/40",
  risk_on_healthy: "bg-soft-green border-signal-green/40",
  neutral: "bg-bg-card border-border",
  undecided: "bg-bg-card border-border",
};

export function MarketSummaryBanner({ summary }: Props): React.ReactElement {
  const t = useT();

  if (!summary) {
    return (
      <div className="border-border bg-bg-card rounded-lg border-2 border-dashed p-4 text-center">
        <p className="text-text-t3 font-mono text-xs tracking-wider">
          {t("piyasa.dominance.phase.no_data")}
        </p>
      </div>
    );
  }

  const bgClass = CLS_BG[summary.cls];
  const label = t(`piyasa.summary.${summary.cls}`);

  return (
    <div className={`rounded-lg border-2 p-4 ${bgClass}`}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-text-t1 font-mono text-xs tracking-widest">
          {t("piyasa.summary.title")}
        </h3>
        <span className="font-mono text-2xs tracking-widest uppercase">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{summary.icon}</span>
        <p className="text-text-t1 flex-1 text-sm">{summary.text}</p>
      </div>
    </div>
  );
}
