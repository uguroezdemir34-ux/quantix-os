"use client";

/**
 * DRAWDOWN METER — Günlük P&L → tier görseli.
 *
 * Tier'a göre renkli card + risk çarpanı.
 */

import { useT, useLocale } from "@/lib/i18n/context";
import { formatPercent } from "@/lib/i18n/format";
import { useAccountStore } from "@/lib/store/accountStore";

const TIER_STYLES = {
  normal: "border-signal-green/40 bg-soft-green text-signal-green",
  caution: "border-signal-amber/40 bg-soft-amber text-signal-amber",
  restricted: "border-signal-amber/60 bg-soft-amber text-signal-amber",
  locked: "border-signal-red/60 bg-soft-red text-signal-red",
} as const;

export function DrawdownMeter(): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const dailyPnlPct = useAccountStore((s) => s.dailyPnlPct);
  const protocol = useAccountStore((s) => s.drawdownProtocol);

  const cls = TIER_STYLES[protocol.tier];

  return (
    <div className={`rounded-lg border-2 p-4 ${cls}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-xs tracking-widest">
          {t("risk.drawdown.title")}
        </h3>
        <span className="font-mono text-xs font-bold tracking-wider">
          {protocol.label}
        </span>
      </div>

      {/* P&L değeri büyük */}
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-3xl font-bold tabular-nums">
            {formatPercent(dailyPnlPct, locale, true)}
          </div>
          <div className="text-text-t3 mt-1 font-mono text-2xs tracking-wider">
            {t("risk.drawdown.dailyPnl")}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-bold tabular-nums">
            {protocol.multiplier}×
          </div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("risk.drawdown.multiplier")}
          </div>
        </div>
      </div>

      {/* Tier bar (visual scale) */}
      <div className="bg-border h-2 overflow-hidden rounded">
        <div
          className={`h-full transition-all ${
            protocol.tier === "locked"
              ? "bg-signal-red w-full"
              : protocol.tier === "restricted"
                ? "bg-signal-amber w-3/4"
                : protocol.tier === "caution"
                  ? "bg-signal-amber w-1/2"
                  : "bg-signal-green w-1/4"
          }`}
        />
      </div>
      <div className="text-text-t4 mt-1 flex justify-between font-mono text-2xs tracking-wider">
        <span>Normal</span>
        <span>Caution</span>
        <span>Restricted</span>
        <span>Locked</span>
      </div>
    </div>
  );
}
