"use client";

/**
 * MTF TREND GRID — 3 TF için BTC ve ETH yön ok matrisi.
 *
 * Bu bileşen INPUT olarak MtfTrendResult bekler.
 * Mum verisini fetch eden ana sayfa olacak (lazy fetch).
 */

import { useT } from "@/lib/i18n/context";
import type {
  MtfTrendResult,
  MtfClass,
  TrendDirection,
} from "@/lib/market/mtfTrend";

interface Props {
  btc: MtfTrendResult | null;
  eth: MtfTrendResult | null;
}

const CLS_COLOR: Record<MtfClass, string> = {
  strong_up: "text-signal-green",
  up: "text-signal-green",
  mixed: "text-signal-amber",
  down: "text-signal-red",
  strong_down: "text-signal-red",
  no_data: "text-text-t3",
};

const DIRECTION_ICON: Record<TrendDirection, string> = {
  up: "▲",
  flat: "—",
  down: "▼",
};

const DIRECTION_COLOR: Record<TrendDirection, string> = {
  up: "text-signal-green",
  flat: "text-text-t3",
  down: "text-signal-red",
};

export function MtfTrendGrid({ btc, eth }: Props): React.ReactElement {
  const t = useT();

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t1 mb-3 font-mono text-xs tracking-widest">
        {t("piyasa.mtf.title")}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <PairColumn pair="BTC" result={btc} t={t} />
        <PairColumn pair="ETH" result={eth} t={t} />
      </div>
    </div>
  );
}

function PairColumn({
  pair,
  result,
  t,
}: {
  pair: "BTC" | "ETH";
  result: MtfTrendResult | null;
  t: (k: string) => string;
}) {
  const cls: MtfClass = result?.cls ?? "no_data";
  const clsColor = CLS_COLOR[cls];
  const clsLabel = t(`piyasa.mtf.cls.${cls}`);

  return (
    <div>
      <div className="text-text-t3 mb-2 font-mono text-2xs tracking-wider">
        {pair}
      </div>

      {/* 3 timeframe yan yana */}
      <div className="border-border bg-bg-page mb-2 grid grid-cols-3 gap-1 rounded-sm border p-2">
        {(["1h", "4h", "1d"] as const).map((tf) => {
          const tr = result?.trends.find((x) => x.tf === tf);
          const dir = tr?.direction ?? "flat";
          const hasData = tr && tr.lastClose !== null;
          return (
            <div key={tf} className="text-center">
              <div className="text-text-t4 font-mono text-2xs tracking-wider">
                {t(`piyasa.mtf.tf.${tf}`)}
              </div>
              <div
                className={`font-mono text-lg font-bold ${
                  hasData ? DIRECTION_COLOR[dir] : "text-text-t3"
                }`}
              >
                {hasData ? DIRECTION_ICON[dir] : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Class etiketi */}
      <div
        className={`font-mono text-2xs tracking-widest uppercase ${clsColor}`}
      >
        {clsLabel}
      </div>
    </div>
  );
}
