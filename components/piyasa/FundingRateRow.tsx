"use client";

/**
 * FUNDING RATE ROW — BTC + ETH funding yan yana.
 */

import { useT } from "@/lib/i18n/context";
import {
  classifyFundingRate,
  type FundingRateResult,
  type FundingTier,
} from "@/lib/market/fundingRate";

interface Props {
  btc: FundingRateResult | null;
  eth: FundingRateResult | null;
  loading?: boolean;
}

const TIER_COLOR: Record<FundingTier, string> = {
  extreme_long: "text-signal-red",
  elevated_long: "text-signal-amber",
  neutral: "text-text-t2",
  elevated_short: "text-signal-amber",
  extreme_short: "text-signal-red",
};

export function FundingRateRow({
  btc,
  eth,
  loading,
}: Props): React.ReactElement {
  const t = useT();

  if (loading && !btc && !eth) {
    return (
      <div className="border-border bg-bg-card h-32 animate-pulse rounded-lg border" />
    );
  }

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t1 mb-3 font-mono text-xs tracking-widest">
        {t("piyasa.funding.title")}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <FundingCell label={t("piyasa.funding.btc")} data={btc} t={t} />
        <FundingCell label={t("piyasa.funding.eth")} data={eth} t={t} />
      </div>
    </div>
  );
}

function FundingCell({
  label,
  data,
  t,
}: {
  label: string;
  data: FundingRateResult | null;
  t: (k: string) => string;
}) {
  if (!data) {
    return (
      <div>
        <div className="text-text-t3 font-mono text-2xs tracking-wider">
          {label}
        </div>
        <div className="font-mono text-lg">—</div>
      </div>
    );
  }

  const tier = classifyFundingRate(data.fundingRate);
  const tierColor = TIER_COLOR[tier];
  const tierLabel = t(`piyasa.funding.tier.${tier}`);
  const ratePct = (data.fundingRate * 100).toFixed(4);
  const sign = data.fundingRate >= 0 ? "+" : "";

  return (
    <div>
      <div className="text-text-t3 font-mono text-2xs tracking-wider">
        {label}
      </div>
      <div
        className={`font-mono text-lg font-bold tabular-nums ${tierColor}`}
      >
        {sign}
        {ratePct}%
      </div>
      <div className="text-text-t4 font-mono text-2xs tracking-wider">
        {t("piyasa.funding.annualized")}: {sign}
        {data.annualizedPct.toFixed(1)}%
      </div>
      <div className={`mt-1 font-mono text-2xs tracking-widest uppercase ${tierColor}`}>
        {tierLabel}
      </div>
    </div>
  );
}
