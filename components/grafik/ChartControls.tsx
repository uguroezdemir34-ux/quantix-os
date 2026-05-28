"use client";

/**
 * CHART CONTROLS — Pair + Timeframe + Overlay seçici.
 */

import { useT } from "@/lib/i18n/context";
import type { Pair } from "@/lib/constants/pairs";
import type { Timeframe } from "@/lib/okx/candles";

interface Props {
  pair: Pair;
  timeframe: Timeframe;
  showEma20: boolean;
  showEma50: boolean;
  showTrades: boolean;
  onPairChange: (p: Pair) => void;
  onTimeframeChange: (tf: Timeframe) => void;
  onToggleEma20: () => void;
  onToggleEma50: () => void;
  onToggleTrades: () => void;
}

const PAIRS: Pair[] = ["BTC", "ETH"];
const TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

export function ChartControls({
  pair,
  timeframe,
  showEma20,
  showEma50,
  showTrades,
  onPairChange,
  onTimeframeChange,
  onToggleEma20,
  onToggleEma50,
  onToggleTrades,
}: Props): React.ReactElement {
  const t = useT();

  return (
    <div className="border-border bg-bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
      {/* Pair */}
      <div className="flex items-center gap-1.5">
        <span className="text-text-t3 font-mono text-2xs tracking-widest uppercase">
          {t("grafik.pairLabel")}
        </span>
        <div className="flex gap-1">
          {PAIRS.map((p) => (
            <button
              key={p}
              onClick={() => onPairChange(p)}
              className={`rounded border px-2 py-1 font-mono text-2xs font-bold tracking-widest uppercase ${
                pair === p
                  ? "border-text-t1 bg-text-t1 text-bg-page"
                  : "border-border text-text-t2 hover:bg-bg-page"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Timeframe */}
      <div className="flex items-center gap-1.5">
        <span className="text-text-t3 font-mono text-2xs tracking-widest uppercase">
          {t("grafik.timeframeLabel")}
        </span>
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => onTimeframeChange(tf)}
              className={`rounded border px-2 py-1 font-mono text-2xs font-bold tracking-widest uppercase ${
                timeframe === tf
                  ? "border-text-t1 bg-text-t1 text-bg-page"
                  : "border-border text-text-t2 hover:bg-bg-page"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Overlays */}
      <div className="flex items-center gap-1.5">
        <span className="text-text-t3 font-mono text-2xs tracking-widest uppercase">
          {t("grafik.overlays")}
        </span>
        <div className="flex gap-1">
          <Toggle active={showEma20} onClick={onToggleEma20}>
            {t("grafik.ema20")}
          </Toggle>
          <Toggle active={showEma50} onClick={onToggleEma50}>
            {t("grafik.ema50")}
          </Toggle>
          <Toggle active={showTrades} onClick={onToggleTrades}>
            {t("grafik.showTrades")}
          </Toggle>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-1 font-mono text-2xs font-bold tracking-widest uppercase ${
        active
          ? "border-text-t1 bg-text-t1 text-bg-page"
          : "border-border text-text-t3 hover:bg-bg-page"
      }`}
    >
      {children}
    </button>
  );
}
