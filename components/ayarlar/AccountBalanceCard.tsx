"use client";

/**
 * ACCOUNT BALANCE CARD — OKX USDT bakiyesi + drawdown durumu.
 *
 * Balance poller 60s'de bir günceller. Kullanıcı butonla manuel yenileyebilir.
 */

import { useState } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { formatPrice, formatPercent } from "@/lib/i18n/format";
import { useAccountStore } from "@/lib/store/accountStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { fetchBalance } from "@/lib/okx/balance";

export function AccountBalanceCard(): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const [refreshing, setRefreshing] = useState(false);

  const balanceTotal = useAccountStore((s) => s.balanceTotal);
  const balanceFree = useAccountStore((s) => s.balanceFree);
  const dailyPnlPct = useAccountStore((s) => s.dailyPnlPct);
  const protocol = useAccountStore((s) => s.drawdownProtocol);
  const setBalance = useAccountStore((s) => s.setBalance);
  const demoMode = useSettingsStore((s) => s.demoMode);

  const usedMargin = balanceTotal - balanceFree;

  const tierColors: Record<string, string> = {
    normal: "text-signal-green",
    caution: "text-signal-amber",
    restricted: "text-signal-amber",
    locked: "text-signal-red",
  };
  const tierColor = tierColors[protocol.tier] ?? "text-text-t1";

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const result = await fetchBalance(demoMode);
      if (result) setBalance(result.total, result.free);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-text-t1 text-sm font-medium">
          💰 {t("settings.balance.title")}
        </h3>
        <div className="flex items-center gap-2">
          {demoMode && (
            <span className="bg-soft-amber text-signal-amber rounded px-1.5 py-0.5 font-mono text-2xs tracking-wider">
              DEMO
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="border-border text-text-t3 hover:text-text-t1 rounded border px-2 py-0.5 font-mono text-xs disabled:opacity-40"
          >
            {refreshing ? "..." : "↻"}
          </button>
        </div>
      </div>

      {/* Bakiye satırları */}
      <div className="space-y-2">
        <BalanceRow
          label={t("settings.balance.total")}
          value={formatPrice(balanceTotal, locale)}
          bold
        />
        <BalanceRow
          label={t("settings.balance.free")}
          value={formatPrice(balanceFree, locale)}
          color="text-signal-green"
        />
        <BalanceRow
          label={t("settings.balance.used")}
          value={formatPrice(usedMargin, locale)}
          color="text-text-t2"
        />
      </div>

      {/* Günlük P&L + drawdown tier */}
      <div className="border-border mt-3 flex items-center justify-between border-t pt-3">
        <div>
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("settings.balance.dailyPnl")}
          </div>
          <div
            className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
              dailyPnlPct >= 0 ? "text-signal-green" : "text-signal-red"
            }`}
          >
            {formatPercent(dailyPnlPct, locale, true)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-text-t3 font-mono text-2xs tracking-wider">
            {t("settings.balance.tier")}
          </div>
          <div className={`mt-0.5 font-mono text-xs font-bold ${tierColor}`}>
            {protocol.label}
          </div>
        </div>
      </div>
    </div>
  );
}

function BalanceRow({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-t3 font-mono text-xs">{label}</span>
      <span
        className={`font-mono text-sm tabular-nums ${bold ? "font-bold text-text-t1" : (color ?? "text-text-t2")}`}
      >
        {value}
      </span>
    </div>
  );
}
