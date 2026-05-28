"use client";

/**
 * PNL STATS CARD — Win rate + Total P&L + Avg R + Profit factor.
 *
 * Tek büyük kart, 4 ana metrik + 2 alt metrik (gross profit/loss).
 */

import { useT, useLocale } from "@/lib/i18n/context";
import { formatPercent } from "@/lib/i18n/format";
import type { PnlStats } from "@/lib/pnl/types";
import { winRateTier } from "@/lib/pnl/types";

interface Props {
  stats: PnlStats;
}

const TIER_BORDERS = {
  excellent: "border-signal-green/40 bg-soft-green",
  good: "border-signal-green/30 bg-soft-green/60",
  fair: "border-signal-amber/40 bg-soft-amber",
  poor: "border-signal-red/40 bg-soft-red/70",
} as const;

export function PnlStatsCard({ stats }: Props): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const tier = winRateTier(stats.winRate);
  const tierLabel = t(`pnl.stats.tier.${tier}`);
  const containerClass = TIER_BORDERS[tier];

  const totalPnlSign = stats.totalPnlUsd >= 0 ? "+" : "";
  const totalPnlColor =
    stats.totalPnlUsd > 0
      ? "text-signal-green"
      : stats.totalPnlUsd < 0
        ? "text-signal-red"
        : "text-text-t2";

  return (
    <div className={`rounded-lg border-2 p-4 ${containerClass}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-xs tracking-widest">
          {t("pnl.stats.title")}
        </h3>
        <span className="font-mono text-2xs font-bold tracking-widest uppercase">
          {tierLabel}
        </span>
      </div>

      {/* Total P&L — büyük */}
      <div className="mb-4">
        <div
          className={`font-mono text-3xl font-bold tabular-nums ${totalPnlColor}`}
        >
          {totalPnlSign}${stats.totalPnlUsd.toFixed(2)}
        </div>
        <div className="text-text-t3 mt-1 font-mono text-2xs tracking-wider">
          {t("pnl.stats.totalPnl")} · {stats.totalTrades}{" "}
          {t("pnl.calendar.tradesLabel")}
        </div>
      </div>

      {/* 3 grid: Win rate + Avg R + Profit factor */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat
          label={t("pnl.stats.winRate")}
          value={formatPercent(stats.winRate, locale)}
          sub={`${stats.winCount} / ${stats.totalTrades}`}
        />
        <Stat
          label={t("pnl.stats.avgR")}
          value={stats.avgR === null ? "—" : stats.avgR.toFixed(2) + "R"}
          sub={stats.avgR === null ? "" : stats.avgR >= 1 ? "↑" : "↓"}
        />
        <Stat
          label={t("pnl.stats.profitFactor")}
          value={
            stats.profitFactor === null
              ? "—"
              : !isFinite(stats.profitFactor)
                ? "∞"
                : stats.profitFactor.toFixed(2)
          }
          sub={
            stats.profitFactor !== null && stats.profitFactor >= 1 ? "✓" : "✗"
          }
        />
      </div>

      {/* Gross profit/loss */}
      <div className="text-text-t3 grid grid-cols-2 gap-2 font-mono text-2xs tracking-wider">
        <div>
          <span className="text-signal-green">+${stats.grossProfit.toFixed(2)}</span>
          <span className="ml-1">{t("pnl.stats.grossProfit")}</span>
        </div>
        <div>
          <span className="text-signal-red">-${stats.grossLoss.toFixed(2)}</span>
          <span className="ml-1">{t("pnl.stats.grossLoss")}</span>
        </div>
      </div>

      {/* Max drawdown alt satır */}
      {stats.maxDrawdownUsd > 0 && (
        <div className="border-border/30 mt-3 border-t pt-2">
          <div className="text-signal-amber flex items-center justify-between font-mono text-2xs tracking-wider">
            <span>{t("pnl.stats.maxDrawdown")}</span>
            <span className="tabular-nums">
              -${stats.maxDrawdownUsd.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="font-mono text-base font-bold tabular-nums">
        {value} {sub && <span className="text-text-t3 text-xs">{sub}</span>}
      </div>
      <div className="text-text-t3 mt-0.5 font-mono text-2xs leading-tight tracking-wider">
        {label}
      </div>
    </div>
  );
}
