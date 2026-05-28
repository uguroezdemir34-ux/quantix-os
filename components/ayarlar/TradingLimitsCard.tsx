"use client";

/**
 * TRADING LIMITS CARD — Max trades/day + Default leverage.
 */

import { useSettingsStore } from "@/lib/store/settingsStore";
import { useT } from "@/lib/i18n/context";

export function TradingLimitsCard(): React.ReactElement {
  const t = useT();
  const maxTradesPerDay = useSettingsStore((s) => s.maxTradesPerDay);
  const defaultLeverage = useSettingsStore((s) => s.defaultLeverage);
  const setMaxTradesPerDay = useSettingsStore((s) => s.setMaxTradesPerDay);
  const setDefaultLeverage = useSettingsStore((s) => s.setDefaultLeverage);

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-text-t1 text-sm font-medium">
          🎯 {t("settings.tradingLimits.title")}
        </h3>
        <p className="text-text-t3 mt-1 text-xs leading-relaxed">
          {t("settings.tradingLimits.description")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Max trades per day */}
        <NumberControl
          label={t("settings.tradingLimits.maxTradesPerDay")}
          description={t("settings.tradingLimits.maxTradesPerDayDescription")}
          value={maxTradesPerDay}
          min={1}
          max={20}
          onChange={setMaxTradesPerDay}
        />

        {/* Default leverage */}
        <NumberControl
          label={t("settings.tradingLimits.defaultLeverage")}
          description={t("settings.tradingLimits.defaultLeverageDescription")}
          value={defaultLeverage}
          min={1}
          max={125}
          step={1}
          suffix="x"
          onChange={setDefaultLeverage}
        />
      </div>
    </div>
  );
}

function NumberControl({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  function decrement() {
    onChange(Math.max(min, value - step));
  }
  function increment() {
    onChange(Math.min(max, value + step));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex-1">
          <div className="text-text-t1 font-mono text-xs tracking-wider">
            {label}
          </div>
          <div className="text-text-t3 mt-0.5 text-2xs leading-relaxed">
            {description}
          </div>
        </div>
        <div className="ml-3 flex items-center gap-2">
          <button
            type="button"
            onClick={decrement}
            disabled={value <= min}
            aria-label={`Decrease ${label}`}
            className="border-border hover:bg-bg-page disabled:opacity-30 rounded border px-2 py-0.5 font-mono text-xs"
          >
            −
          </button>
          <span className="text-text-t1 font-mono text-base font-bold tabular-nums w-12 text-center">
            {value}
            {suffix && (
              <span className="text-text-t3 ml-0.5 text-xs">{suffix}</span>
            )}
          </span>
          <button
            type="button"
            onClick={increment}
            disabled={value >= max}
            aria-label={`Increase ${label}`}
            className="border-border hover:bg-bg-page disabled:opacity-30 rounded border px-2 py-0.5 font-mono text-xs"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
