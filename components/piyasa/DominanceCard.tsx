"use client";

/**
 * DOMINANCE CARD — BTC.D + USDT.D + faz açıklaması.
 */

import { useT } from "@/lib/i18n/context";
import type { DominanceInfo } from "@/lib/macro/types";

interface Props {
  info: DominanceInfo | null;
  loading?: boolean;
}

const PHASE_COLOR = {
  risk_off_usdt: "text-signal-red",
  btc_trend: "text-signal-amber",
  altcoin_season: "text-signal-green",
  mixed: "text-text-t2",
  no_data: "text-text-t3",
} as const;

export function DominanceCard({ info, loading }: Props): React.ReactElement {
  const t = useT();

  if (!info && loading) {
    return (
      <div className="border-border bg-bg-card h-48 animate-pulse rounded-lg border" />
    );
  }

  if (!info) {
    return (
      <div className="border-border bg-bg-card rounded-lg border p-4">
        <h3 className="text-text-t1 font-mono text-xs tracking-widest">
          {t("piyasa.dominance.title")}
        </h3>
        <p className="text-text-t3 mt-2 text-xs">—</p>
      </div>
    );
  }

  const phaseLabel = t(`piyasa.dominance.phase.${info.phase}`);
  const phaseColor = PHASE_COLOR[info.phase];

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t1 mb-3 font-mono text-xs tracking-widest">
        {t("piyasa.dominance.title")}
      </h3>

      {/* 2 sütun: BTC.D + USDT.D */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("piyasa.dominance.btcD")}
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums">
            {info.btcD > 0 ? info.btcD.toFixed(1) + "%" : "—"}
          </div>
        </div>
        <div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("piyasa.dominance.usdtD")}
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums">
            {info.usdtD > 0 ? info.usdtD.toFixed(2) + "%" : "—"}
          </div>
        </div>
      </div>

      {/* Faz */}
      <div
        className={`mt-3 border-border border-t pt-2 font-mono text-2xs tracking-widest uppercase ${phaseColor}`}
      >
        {phaseLabel}
      </div>
    </div>
  );
}
