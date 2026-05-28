"use client";

/**
 * TRADE CONFIRM MODAL — Pozisyon açmadan önce son onay.
 */

import { useEffect } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { formatPrice, formatCoinAmount, formatPercent } from "@/lib/i18n/format";
import type { PositionSizerResult } from "@/lib/sizer/types";

export function TradeConfirmModal({
  result,
  onConfirm,
  onClose,
}: {
  result: PositionSizerResult;
  onConfirm: () => void;
  onClose: () => void;
}): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const isLong = result.direction === "LONG";
  const dirCls = isLong ? "text-signal-green" : "text-signal-red";

  // Esc tuşu ile kapat
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-confirm-title"
      onClick={onClose}
    >
      <div
        className="border-border bg-bg-card max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="trade-confirm-title"
          className="text-text-t1 mb-4 font-mono text-sm tracking-widest"
        >
          {t("confirm.title")}
        </h2>

        {/* Yön + büyük */}
        <div className={`text-center font-mono text-3xl font-bold ${dirCls}`}>
          {isLong ? "▲" : "▼"} {t(isLong ? "direction.long" : "direction.short")}
        </div>
        <div className="text-text-t3 mt-1 text-center font-mono text-sm tracking-wider">
          {result.pair} · {t("confirm.pair")}
        </div>

        {/* Tablo */}
        <div className="border-border mt-4 space-y-2 border-t pt-3 text-sm">
          <Row label={t("sizer.entry")} value={formatPrice(result.px, locale)} />
          <Row
            label={t("sizer.stop")}
            value={formatPrice(result.stop.stopPrice, locale)}
            color="text-signal-red"
          />
          <Row
            label={t("sizer.tp1")}
            value={formatPrice(result.tp.tp1Price, locale)}
            color="text-signal-green"
            sub={`${t("sizer.rr")} ${result.rr1.toFixed(2)}`}
          />
          <Row
            label={t("sizer.tp2")}
            value={formatPrice(result.tp.tp2Price, locale)}
            color="text-signal-green"
            sub={`${t("sizer.rr")} ${result.rr2.toFixed(2)}`}
          />
        </div>

        <div className="border-border mt-3 space-y-2 border-t pt-3 text-sm">
          <Row
            label={t("sizer.size")}
            value={`${formatCoinAmount(result.qty, result.pair, locale)} ${result.pair}`}
            sub={formatPrice(result.notional, locale)}
          />
          <Row
            label={t("sizer.margin")}
            value={formatPrice(result.margin, locale)}
            sub={t("sizer.leverageHint", { n: result.leverage })}
          />
          <Row
            label={t("sizer.risk")}
            value={formatPrice(result.risk.riskUsd, locale)}
            sub={formatPercent(result.risk.riskPct * 100, locale)}
          />
        </div>

        {/* Disclaimers */}
        <div className="text-text-t3 mt-4 space-y-1 text-2xs leading-relaxed">
          <p>{t("confirm.disclaimer1")}</p>
          <p>{t("confirm.disclaimer2")}</p>
          <p>{t("confirm.disclaimer3", { pct: (result.risk.riskPct * 100).toFixed(2) })}</p>
        </div>

        {/* Butonlar */}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border-border text-text-t2 hover:bg-bg flex-1 rounded-md border py-2 font-mono text-sm tracking-wider transition-colors"
          >
            {t("confirm.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-md py-2 font-mono text-sm font-bold tracking-wider transition-colors ${
              isLong ? "bg-signal-green" : "bg-signal-red"
            } text-bg hover:opacity-90`}
          >
            {t("confirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-text-t3 font-mono text-2xs tracking-wider">
        {label}
      </span>
      <div className="text-right">
        <div className={`font-mono tabular-nums ${color ?? "text-text-t1"}`}>
          {value}
        </div>
        {sub && <div className="text-text-t4 font-mono text-2xs">{sub}</div>}
      </div>
    </div>
  );
}
