"use client";

import { useEffect } from "react";
import { useMacroStore } from "@/lib/store/macroStore";
import { MarketSummaryBanner } from "@/components/piyasa/MarketSummaryBanner";
import { FearGreedGauge } from "@/components/piyasa/FearGreedGauge";
import { DominanceCard } from "@/components/piyasa/DominanceCard";
import { MtfTrendGrid } from "@/components/piyasa/MtfTrendGrid";
import { FundingRateRow } from "@/components/piyasa/FundingRateRow";

export default function PiyasaPage() {
  const store = useMacroStore();

  useEffect(() => {
    store.refreshAll();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <MarketSummaryBanner summary={store.marketSummary} />
      <FearGreedGauge info={store.fgInfo} loading={store.fgLoading} />
      <DominanceCard info={store.dominance} loading={store.domLoading} />
      <MtfTrendGrid btc={null} eth={null} />
      <FundingRateRow
        btc={store.fundingBtc}
        eth={store.fundingEth}
        loading={store.fundingLoading}
      />
    </div>
  );
}
