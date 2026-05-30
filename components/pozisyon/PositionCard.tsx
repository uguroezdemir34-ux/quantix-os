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

import { useState, useEffect, useRef } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { formatPrice, formatPercent, formatCoinAmount } from "@/lib/i18n/format";
import { useMarketStore } from "@/lib/store/marketStore";
import {
  computeLiveUpl,
  computeRoe,
  computeTpProgress,
  categorizeHoldingDuration,
} from "@/lib/sizer/position-pnl";
import { getActiveTrailingManager } from "@/lib/trailing/managerRef";
import type { TrailUiDurum } from "@/lib/trailing/manager";
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

  // Trail stop durumu — 3 saniyede bir yenile (manager dışarıdan event yayınlamıyor)
  const [trailDurum, setTrailDurum] = useState<TrailUiDurum | null>(null);
  const trailIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    function refresh() {
      const d = getActiveTrailingManager()?.getDurum(position.instId) ?? null;
      setTrailDurum(d);
    }
    refresh();
    trailIntervalRef.current = setInterval(refresh, 3000);
    return () => {
      if (trailIntervalRef.current) clearInterval(trailIntervalRef.current);
    };
  }, [position.instId]);

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
      <div className="mb-4 flex min-w-0 items-baseline justify-between gap-2">
        <div className="min-w-0 shrink">
          <div className={`overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xl font-bold tabular-nums ${uplColor}`}>
            {formatPercent(roe, locale, true)}
          </div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            ROE
          </div>
        </div>
        <div className="min-w-0 shrink-0 text-right">
          <div className={`overflow-hidden text-ellipsis whitespace-nowrap font-mono text-base tabular-nums ${uplColor}`}>
            {liveUpl >= 0 ? "+" : ""}
            {formatPrice(liveUpl, locale)}
          </div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("position.upl")}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
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
      <div className="border-border mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
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

      {/* Trailing stop satırı (ralli aktifleşince görünür) */}
      {trailDurum && (
        <div className="border-border mt-3 border-t pt-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-text-t3 font-mono text-2xs tracking-wider">
                {t("position.trailStop")}
              </span>
              {trailDurum.rallyActivated ?? false ? (
                <span className="bg-warning/15 text-warning rounded px-1.5 py-0.5 font-mono text-2xs font-bold tracking-wider">
                  {t("position.trailRally")}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-t4 font-mono text-2xs">
                {t("position.trailMult")}{trailDurum.atr_carpan.toFixed(2)}
              </span>
              <span className="text-text-t4 font-mono text-2xs">
                {t("position.trailPeak")} {trailDurum.peak_kar_yuzde.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className={`font-mono tabular-nums text-sm font-semibold ${
              trailDurum.aktif_stop
                ? isLong ? "text-signal-red" : "text-signal-green"
                : "text-text-t4"
            }`}>
              {trailDurum.aktif_stop
                ? formatPrice(trailDurum.aktif_stop, locale)
                : t("position.trailNoStop")}
            </span>
            {trailDurum.en_iyi_fiyat && (
              <span className="text-text-t4 font-mono text-2xs tabular-nums">
                ↑ {formatPrice(trailDurum.en_iyi_fiyat, locale)}
              </span>
            )}
          </div>
          {/* Trail stop mesafe barı — stop ne kadar yakın? */}
          {trailDurum.aktif_stop && currentPx > 0 && (
            <TrailDistanceBar
              stopPx={trailDurum.aktif_stop}
              currentPx={currentPx}
              entryPx={position.entryPx}
              isLong={isLong}
            />
          )}
        </div>
      )}

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
      <div className="text-text-t1 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono tabular-nums">{value}</div>
      {sub && <div className="text-text-t4 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs">{sub}</div>}
    </div>
  );
}

/**
 * Trail stop'un güncel fiyata olan mesafesini görselleştirir.
 * Bar doluluk oranı: stop ne kadar yakınsa bar o kadar dolu (kırmızı).
 * Referans: entry → stop aralığının %100'ü = tam dolu = stop tetiklendi.
 */
function TrailDistanceBar({
  stopPx,
  currentPx,
  entryPx,
  isLong,
}: {
  stopPx: number;
  currentPx: number;
  entryPx: number;
  isLong: boolean;
}) {
  // LONG: stop altında → mesafe = (current - stop) / (current - entry + stop_dist)
  // Basit görsel: stop distance / entry_distance × 100 (0=uzak, 100=stop seviyesinde)
  const totalRange = Math.abs(currentPx - entryPx) + Math.abs(currentPx - stopPx);
  if (totalRange <= 0) return null;
  const stopDist = isLong ? currentPx - stopPx : stopPx - currentPx;
  const fillPct = Math.max(0, Math.min(100, (1 - stopDist / totalRange) * 100));
  const barColor =
    fillPct > 75
      ? "bg-signal-red"
      : fillPct > 50
      ? "bg-warning"
      : "bg-signal-green";

  return (
    <div className="mt-2">
      <div className="bg-border h-1 overflow-hidden rounded">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
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
