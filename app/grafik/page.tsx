import dynamic from "next/dynamic";
import { ChartControls } from "@/components/grafik/ChartControls";
import { ChartLegend } from "@/components/grafik/ChartLegend";

const PriceChart = dynamic(
  () => import("@/components/grafik/PriceChart").then((m) => m.PriceChart),
  { ssr: false }
);

export default function GrafikPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <ChartControls />
      <ChartLegend />
      <PriceChart series={{ candles: [] }} />
    </div>
  );
}
