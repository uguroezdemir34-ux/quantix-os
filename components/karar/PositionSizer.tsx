"use client";

/**
 * POSITION SIZER — Pozisyon büyüklüğü gösterimi.
 *
 * Verdict=go olduğunda Karar sayfasında görünür.
 * Entry/SL/TP1/TP2 fiyatları, qty, margin, R:R, uyarılar.
 */

import { useT, useLocale } from "@/lib/i18n/context";
import { formatPrice, formatCoinAmount, formatPercent } from "@/lib/i18n/format";
import type { PositionSizerResult } from "@/lib/sizer/types";

export function PositionSizer({
  result,
  onTrade,
}: {
  result: PositionSizerResult;
  onTrade: () => void;
}): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const isLong = result.direction === "LONG";
  const dirColor = isLong ? "text-signal-green" : "text-signal-red";

  return (
    <div className="border-brand bg-bg-card rounded-lg border-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-text-t1 font-mono text-xs tracking-widest">
          {t("sizer.title")}
        </h3>
        <span
          className={`font-mono text-xs font-bold tracking-wider ${dirColor}`}
        >
          {t(isLong ? "direction.long" : "direction.short")}
        </span>
      </div>

      {/* Fiyat tablosu */}
      <div className="space-y-2">
        <PriceRow
          label={t("sizer.entry")}
          value={formatPrice(result.px, locale)}
          neutral
        />
        <PriceRow
          label={t("sizer.stop")}
          value={formatPrice(result.stop.stopPrice, locale)}
          pct={formatPercent(isLong ? -result.stopPct : result.stopPct, locale, true)}
          sub={result.stop.label}
          color="text-signal-red"
        />
        <PriceRow
          label={t("sizer.tp1")}
          value={formatPrice(result.tp.tp1Price, locale)}
          pct={formatPercent(isLong ? result.tp1Pct : -result.tp1Pct, locale, true)}
          sub={`${t("sizer.rr")} ${result.rr1.toFixed(2)} · ${result.tp.label}`}
          color="text-signal-green"
        />
        <PriceRow
          label={t("sizer.tp2")}
          value={formatPrice(result.tp.tp2Price, locale)}
          pct={formatPercent(isLong ? result.tp2Pct : -result.tp2Pct, locale, true)}
          sub={`${t("sizer.rr")} ${result.rr2.toFixed(2)}`}
          color="text-signal-green"
        />
      </div>

      {/* Boyut + risk */}
      <div className="border-border mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 sm:grid-cols-4">
        <Stat
          label={t("sizer.size")}
          value={`${formatCoinAmount(result.qty, result.pair, locale)} ${result.pair}`}
          sub={formatPrice(result.notional, locale)}
        />
        <Stat
          label={t("sizer.margin")}
          value={formatPrice(result.margin, locale)}
          sub={t("sizer.leverageHint", { n: result.leverage })}
        />
        <Stat
          label={t("sizer.risk")}
          value={formatPrice(result.risk.riskUsd, locale)}
          sub={formatPercent(result.risk.riskPct * 100, locale)}
        />
        <Stat
          label={t("sizer.stopDistance")}
          value={formatPercent(result.stopPct, locale)}
          sub={result.stop.kind}
        />
      </div>

      {/* Risk çarpan detayları */}
      {(result.risk.bucketAdj !== 1.0 || result.risk.ddAdj !== 1.0) && (
        <div className="border-border mt-3 border-t pt-3">
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("sizer.riskMultipliers")}
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className="text-text-t2">
              {t("sizer.base")}: {formatPercent(result.risk.baseRiskPct * 100, locale)}
            </span>
            {result.risk.bucketAdj !== 1.0 && (
              <span
                className={
                  result.risk.bucketAdj > 1
                    ? "text-signal-green"
                    : "text-signal-amber"
                }
              >
                × {t("sizer.bucket")} {result.risk.bucketAdj}
              </span>
            )}
            {result.risk.ddAdj !== 1.0 && (
              <span
                className={
                  result.risk.ddAdj === 0
                    ? "text-signal-red"
                    : "text-signal-amber"
                }
              >
                × {t("sizer.drawdown")} {result.risk.ddAdj}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Uyarı */}
      {result.warnMessage && (
        <div
          className={`mt-3 rounded p-2 font-mono text-2xs ${
            result.warnLevel === "blocked"
              ? "bg-soft-red text-signal-red"
              : "bg-soft-amber text-signal-amber"
          }`}
        >
          {result.warnMessage}
        </div>
      )}

      {/* Trade butonu */}
      <button
        type="button"
        onClick={onTrade}
        disabled={result.warnLevel === "blocked"}
        className={`mt-4 w-full rounded-md py-3 font-mono text-sm font-bold tracking-widest transition-colors ${
          result.warnLevel === "blocked"
            ? "bg-border text-text-t4 cursor-not-allowed"
            : `${isLong ? "bg-signal-green" : "bg-signal-red"} text-bg hover:opacity-90`
        }`}
      >
        {result.warnLevel === "blocked"
          ? t("sizer.blocked")
          : t(isLong ? "sizer.longOpen" : "sizer.shortOpen")}
      </button>
    </div>
  );
}

// ───────────────────────── Sub-components ─────────────────────────

function PriceRow({
  label,
  value,
  pct,
  sub,
  color,
  neutral,
}: {
  label: string;
  value: string;
  pct?: string;
  sub?: string;
  color?: string;
  neutral?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="text-text-t3 w-12 shrink-0 font-mono text-2xs tracking-wider">
        {label}
      </span>
      <span
        className={`shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-sm tabular-nums ${neutral ? "text-text-t1" : color}`}
      >
        {value}
      </span>
      <span className="text-text-t4 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs">
        {pct && <span>{pct}</span>}
        {pct && sub && <span> · </span>}
        {sub && <span>{sub}</span>}
      </span>
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
      <div className="text-text-t3 font-mono text-2xs tracking-wider">
        {label}
      </div>
      <div className="text-text-t1 mt-0.5 font-mono text-sm tabular-nums">
        {value}
      </div>
      {sub && <div className="text-text-t4 font-mono text-2xs">{sub}</div>}
    </div>
  );
}
