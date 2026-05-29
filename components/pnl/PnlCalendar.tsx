"use client";

/**
 * PNL CALENDAR — 30 günlük renkli kare matrisi.
 *
 * Her gün için renk:
 *   - Gri: trade yok
 *   - Açık yeşil: küçük kazanç
 *   - Koyu yeşil: büyük kazanç
 *   - Açık kırmızı: küçük kayıp
 *   - Koyu kırmızı: büyük kayıp
 *
 * Hover'da gün detayı (trade count + total pnl).
 */

import { useState, useMemo } from "react";
import { useT } from "@/lib/i18n/context";
import type { DailyAggregate } from "@/lib/pnl/types";

interface Props {
  aggregates: DailyAggregate[];
  /** Renk skalası için referans: en büyük |pnl| */
  maxAbsPnl?: number;
}

type Lookback = 30 | 7;

export function PnlCalendar({
  aggregates,
  maxAbsPnl,
}: Props): React.ReactElement {
  const t = useT();
  const [hovered, setHovered] = useState<DailyAggregate | null>(null);
  const [lookback, setLookback] = useState<Lookback>(30);

  // Lookback filtresi — son N gün
  const visible = useMemo(() => {
    if (lookback === 30) return aggregates;
    return aggregates.slice(-7);
  }, [aggregates, lookback]);

  // Renk yoğunluğu için referans değer
  const refMax =
    maxAbsPnl ??
    aggregates.reduce(
      (m, a) => Math.max(m, Math.abs(a.totalPnlUsd)),
      1, // min 1 USD (0'a bölmeyi engelle)
    );

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-text-t1 font-mono text-xs tracking-widest">
          {t("pnl.calendar.title")}
        </h3>
        <div className="flex gap-1">
          {([30, 7] as Lookback[]).map((lb) => (
            <button
              key={lb}
              type="button"
              onClick={() => setLookback(lb)}
              className={`rounded border px-2 py-0.5 font-mono text-2xs tracking-wider transition-colors ${
                lookback === lb
                  ? "border-text-t2 text-text-t1 bg-surface-s2"
                  : "border-border text-text-t3"
              }`}
            >
              {lb === 30 ? t("pnl.calendar.lookback30d") : t("pnl.calendar.lookback7d")}
            </button>
          ))}
        </div>
      </div>

      {/* Grid: 7 kolon (haftalık), N satır */}
      <div className="grid grid-cols-7 gap-1.5">
        {visible.map((a) => (
          <DayCell
            key={a.date}
            agg={a}
            refMax={refMax}
            onMouseEnter={() => setHovered(a)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>

      {/* Hover detay */}
      {hovered && (
        <div className="border-border mt-3 border-t pt-2 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-t1 font-bold">{hovered.date}</span>
            <span className="text-text-t3 text-2xs">
              {hovered.tradeCount === 0
                ? t("pnl.calendar.noTrades")
                : `${hovered.tradeCount} ${t("pnl.calendar.tradesLabel")}`}
            </span>
          </div>
          {hovered.tradeCount > 0 && (
            <div
              className={`tabular-nums ${
                hovered.totalPnlUsd > 0
                  ? "text-signal-green"
                  : hovered.totalPnlUsd < 0
                    ? "text-signal-red"
                    : "text-text-t2"
              }`}
            >
              {hovered.totalPnlUsd >= 0 ? "+" : ""}${hovered.totalPnlUsd.toFixed(2)}{" "}
              · W{hovered.winCount} L{hovered.lossCount}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="text-text-t4 mt-3 flex items-center justify-between font-mono text-2xs tracking-wider">
        <div className="flex items-center gap-1">
          <div className="bg-signal-red h-3 w-3 rounded-sm" />
          <span>Loss</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="bg-bg-page h-3 w-3 rounded-sm border border-border" />
          <span>0</span>
        </div>
        <div className="flex items-center gap-1">
          <span>Win</span>
          <div className="bg-signal-green h-3 w-3 rounded-sm" />
        </div>
      </div>
    </div>
  );
}

function DayCell({
  agg,
  refMax,
  onMouseEnter,
  onMouseLeave,
}: {
  agg: DailyAggregate;
  refMax: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  let bgClass = "bg-bg-page border border-border";
  let title = `${agg.date}: ${t_noTrades(agg)}`;

  if (agg.tradeCount > 0) {
    const intensity = Math.min(1, Math.abs(agg.totalPnlUsd) / refMax);
    if (agg.totalPnlUsd > 0) {
      // Açık → koyu yeşil
      if (intensity > 0.66) bgClass = "bg-signal-green";
      else if (intensity > 0.33) bgClass = "bg-signal-green/70";
      else bgClass = "bg-soft-green border border-signal-green/40";
    } else if (agg.totalPnlUsd < 0) {
      if (intensity > 0.66) bgClass = "bg-signal-red";
      else if (intensity > 0.33) bgClass = "bg-signal-red/70";
      else bgClass = "bg-soft-red border border-signal-red/40";
    } else {
      // Breakeven trade'ler
      bgClass = "bg-text-t3/20 border border-text-t3/40";
    }
    const sign = agg.totalPnlUsd >= 0 ? "+" : "";
    title = `${agg.date}: ${sign}$${agg.totalPnlUsd.toFixed(2)} (${agg.tradeCount})`;
  }

  return (
    <div
      className={`aspect-square cursor-help rounded-sm transition-opacity hover:opacity-80 ${bgClass}`}
      title={title}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

function t_noTrades(agg: DailyAggregate): string {
  return agg.tradeCount === 0 ? "—" : `${agg.totalPnlUsd}`;
}
