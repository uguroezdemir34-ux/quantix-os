"use client";

/**
 * POSITION CARD — Tek bir açık pozisyonun görünümü.
 *
 * Yapı:
 *   Header: pair + LONG/SHORT badge + holding süresi
 *   Stats: Entry / Mark / UPL / ROE (live updated)
 *   SL/TP: Stop Loss + Take Profit fiyatları
 *   TP1 progress bar (varsa)
 *   Close button
 */

import { useT, useLocale } from "@/lib/i18n/context";
import { formatPrice, formatPercent, formatCoinAmount } from "@/lib/i18n/format";
import { useMarketStore } from "@/lib/store/marketStore";
import {
  computeLiveUpl,
  computeRoe,
  computeTpProgress,
  categorizeHoldingDuration,
} from "@/lib/sizer/position-pnl";
import type { Position } from "@/lib/okx/positions";

export function PositionCard({
  position,
  onClose,
  isClosing,
}: {
  position: Position;
  onClose: () => void;
  isClosing: boolean;
}): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const tick = useMarketStore((s) => s.prices[position.pair]);

  const currentPx = tick?.last ?? position.markPx;
  const liveUpl = computeLiveUpl(position, currentPx);
  const roe = computeRoe(position, currentPx);
  const tpProgress = computeTpProgress(position, currentPx);

  const isLong = position.direction === "LONG";
  const dirColor = isLong ? "text-signal-green" : "text-signal-red";
  const dirBg = isLong
    ? "bg-soft-green border-signal-green/40"
    : "bg-soft-red border-signal-red/40";
  const uplColor = liveUpl >= 0 ? "text-signal-green" : "text-signal-red";

  const holding = categorizeHoldingDuration(position.cTime);
  const holdingText = (() => {
    switch (holding.category) {
      case "lessThanHour":
        return t("position.holdingLessHour");
      case "hours":
        return t("position.holdingHours", { n: Math.floor(holding.hours) });
      case "day":
        return t("position.holdingDay");
      case "days":
        return t("position.holdingDays", { n: Math.floor(holding.hours / 24) });
      case "week":
        return t("position.holdingWeek");
    }
  })();

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      {/* Header */}
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <span className="text-text-t1 font-mono text-base font-semibold tracking-wider">
            {position.pair}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-2xs font-bold tracking-wider ${dirBg} ${dirColor}`}
          >
            <span>{isLong ? "▲" : "▼"}</span>
            <span>{t(isLong ? "direction.long" : "direction.short")}</span>
          </span>
          <span className="text-text-t4 font-mono text-2xs tracking-wider">
            {position.leverage}x
          </span>
        </div>
        <span className="text-text-t4 font-mono text-2xs tracking-wider">
          {holdingText}
        </span>
      </div>

      {/* UPL — big, primary signal */}
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className={`font-mono text-2xl font-bold tabular-nums ${uplColor}`}>
            {formatPercent(roe, locale, true)}
          </div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            ROE
          </div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-base tabular-nums ${uplColor}`}>
            {liveUpl >= 0 ? "+" : ""}
            {formatPrice(liveUpl, locale)}
          </div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("position.upl")}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Stat
          label={t("position.entry")}
          value={formatPrice(position.entryPx, locale)}
        />
        <Stat
          label={t("position.mark")}
          value={formatPrice(currentPx, locale)}
        />
        <Stat
          label={t("position.size")}
          value={`${formatCoinAmount(position.size, position.pair, locale)} ${position.pair}`}
          sub={formatPrice(position.notional, locale)}
        />
        <Stat
          label={t("position.margin")}
          value={formatPrice(position.notional / position.leverage, locale)}
        />
      </div>

      {/* SL/TP row */}
      <div className="border-border mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
        <SlTpStat
          label={t("position.stopLoss")}
          value={position.slTriggerPx}
          fallback={t("position.noSlSet")}
          locale={locale}
          color="text-signal-red"
        />
        <SlTpStat
          label={t("position.takeProfit")}
          value={position.tpTriggerPx}
          fallback={t("position.noTpSet")}
          locale={locale}
          color="text-signal-green"
        />
      </div>

      {/* TP1 progress bar (only if TP set) */}
      {tpProgress !== null && (
        <div className="mt-3">
          <div className="text-text-t3 mb-1 flex justify-between font-mono text-2xs tracking-wider">
            <span>{t("position.tp1Progress")}</span>
            <span className="tabular-nums">{tpProgress.toFixed(0)}%</span>
          </div>
          <div className="bg-border h-1.5 overflow-hidden rounded">
            <div
              className="bg-signal-green h-full transition-all"
              style={{ width: `${tpProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Liquidation warning (if liq close) */}
      {position.liqPx && (
        <div className="text-text-t4 mt-3 font-mono text-2xs tracking-wider">
          {t("position.liqPrice")}: {formatPrice(position.liqPx, locale)}
        </div>
      )}

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        disabled={isClosing}
        className={`mt-4 w-full rounded-md py-2.5 font-mono text-sm font-bold tracking-widest transition-colors ${
          isClosing
            ? "bg-border text-text-t4 cursor-wait"
            : "border-signal-red text-signal-red hover:bg-signal-red hover:text-white border bg-transparent"
        }`}
      >
        {isClosing ? t("position.closing") : `✕ ${t("position.closeButton")}`}
      </button>
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
      <div className="text-text-t1 mt-0.5 font-mono tabular-nums">{value}</div>
      {sub && <div className="text-text-t4 font-mono text-2xs">{sub}</div>}
    </div>
  );
}

function SlTpStat({
  label,
  value,
  fallback,
  locale,
  color,
}: {
  label: string;
  value: number | null;
  fallback: string;
  locale: "en" | "tr";
  color: string;
}) {
  return (
    <div>
      <div className="text-text-t3 font-mono text-2xs tracking-wider">
        {label}
      </div>
      <div className={`mt-0.5 font-mono tabular-nums ${value ? color : "text-text-t4"}`}>
        {value ? formatPrice(value, locale) : fallback}
      </div>
    </div>
  );
}
