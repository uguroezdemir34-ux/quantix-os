"use client";

import { useMemo } from "react";
import { useMacroStore } from "@/lib/store/macroStore";
import { useCandleStore, EMPTY_CANDLES } from "@/lib/store/candleStore";
import { MarketSummaryBanner } from "@/components/piyasa/MarketSummaryBanner";
import { FearGreedGauge } from "@/components/piyasa/FearGreedGauge";
import { DominanceCard } from "@/components/piyasa/DominanceCard";
import { MtfTrendGrid } from "@/components/piyasa/MtfTrendGrid";
import { FundingRateRow } from "@/components/piyasa/FundingRateRow";
import { computeMtfTrend } from "@/lib/market/mtfTrend";

export default function PiyasaPage() {
  const marketSummary = useMacroStore((s) => s.marketSummary);
  const fgInfo = useMacroStore((s) => s.fgInfo);
  const fgLoading = useMacroStore((s) => s.fgLoading);
  const dominance = useMacroStore((s) => s.dominance);
  const domLoading = useMacroStore((s) => s.domLoading);
  const fundingBtc = useMacroStore((s) => s.fundingBtc);
  const fundingEth = useMacroStore((s) => s.fundingEth);
  const fundingLoading = useMacroStore((s) => s.fundingLoading);

  const btc1hRaw = useCandleStore((s) => s.candles["BTC_1h"]);
  const btc4hRaw = useCandleStore((s) => s.candles["BTC_4h"]);
  const btc1dRaw = useCandleStore((s) => s.candles["BTC_1d"]);
  const eth1hRaw = useCandleStore((s) => s.candles["ETH_1h"]);
  const eth4hRaw = useCandleStore((s) => s.candles["ETH_4h"]);
  const eth1dRaw = useCandleStore((s) => s.candles["ETH_1d"]);
  const btc1h = btc1hRaw ?? EMPTY_CANDLES;
  const btc4h = btc4hRaw ?? EMPTY_CANDLES;
  const btc1d = btc1dRaw ?? EMPTY_CANDLES;
  const eth1h = eth1hRaw ?? EMPTY_CANDLES;
  const eth4h = eth4hRaw ?? EMPTY_CANDLES;
  const eth1d = eth1dRaw ?? EMPTY_CANDLES;

  const btcMtf = useMemo(
    () =>
      btc1h.length >= 20
        ? computeMtfTrend("BTC", btc1h, btc4h, btc1d)
        : null,
    [btc1h, btc4h, btc1d],
  );

  const ethMtf = useMemo(
    () =>
      eth1h.length >= 20
        ? computeMtfTrend("ETH", eth1h, eth4h, eth1d)
        : null,
    [eth1h, eth4h, eth1d],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <MarketSummaryBanner summary={marketSummary} />
      <FearGreedGauge info={fgInfo} loading={fgLoading} />
      <DominanceCard info={dominance} loading={domLoading} />
      <MtfTrendGrid btc={btcMtf} eth={ethMtf} />
      <FundingRateRow
        btc={fundingBtc}
        eth={fundingEth}
        loading={fundingLoading}
      />
    </div>
  );
}
