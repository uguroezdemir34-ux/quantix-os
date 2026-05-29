"use client";

import { useEffect, useMemo } from "react";
import { useMacroStore } from "@/lib/store/macroStore";
import { useCandleStore } from "@/lib/store/candleStore";
import { MarketSummaryBanner } from "@/components/piyasa/MarketSummaryBanner";
import { FearGreedGauge } from "@/components/piyasa/FearGreedGauge";
import { DominanceCard } from "@/components/piyasa/DominanceCard";
import { MtfTrendGrid } from "@/components/piyasa/MtfTrendGrid";
import { FundingRateRow } from "@/components/piyasa/FundingRateRow";
import { computeMtfTrend } from "@/lib/market/mtfTrend";

export default function PiyasaPage() {
  const store = useMacroStore();

  const btc1h = useCandleStore((s) => s.candles["BTC_1h"] ?? []);
  const btc4h = useCandleStore((s) => s.candles["BTC_4h"] ?? []);
  const btc1d = useCandleStore((s) => s.candles["BTC_1d"] ?? []);
  const eth1h = useCandleStore((s) => s.candles["ETH_1h"] ?? []);
  const eth4h = useCandleStore((s) => s.candles["ETH_4h"] ?? []);
  const eth1d = useCandleStore((s) => s.candles["ETH_1d"] ?? []);

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

  useEffect(() => {
    store.refreshAll();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <MarketSummaryBanner summary={store.marketSummary} />
      <FearGreedGauge info={store.fgInfo} loading={store.fgLoading} />
      <DominanceCard info={store.dominance} loading={store.domLoading} />
      <MtfTrendGrid btc={btcMtf} eth={ethMtf} />
      <FundingRateRow
        btc={store.fundingBtc}
        eth={store.fundingEth}
        loading={store.fundingLoading}
      />
    </div>
  );
}
