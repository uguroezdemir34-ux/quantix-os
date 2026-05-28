"use client";

/**
 * CONNECTION BADGE — WS bağlantı durumu mini rozet.
 *
 * Panel'in tbWs pill'inin v2 karşılığı:
 *   - connected: yeşil "OKX" veya "BN"
 *   - silent: amber "SLNT"
 *   - connecting: amber "..."
 *   - disconnected: kırmızı "OFF"
 *   - destroyed: gri "—"
 */

import {
  useMarketStore,
  selectConnectionStatus,
} from "@/lib/store/marketStore";
import { useHydrated } from "@/lib/store/hydration";
import { useT } from "@/lib/i18n/context";

export function ConnectionBadge(): React.ReactElement | null {
  const hydrated = useHydrated();
  const status = useMarketStore(selectConnectionStatus);
  const currentType = useMarketStore((s) => s.connection.currentType);
  const t = useT();

  if (!hydrated) return null;

  let label: string;
  let cls: string;

  switch (status) {
    case "connected":
      label = currentType === "binance" ? t("connection.binance") : t("connection.okx");
      cls = "bg-soft-green text-signal-green";
      break;
    case "connecting":
      label = t("connection.connecting");
      cls = "bg-soft-amber text-signal-amber animate-pulse";
      break;
    case "silent":
      label = t("connection.silent");
      cls = "bg-soft-amber text-signal-amber";
      break;
    case "disconnected":
      label = t("connection.offline");
      cls = "bg-soft-red text-signal-red";
      break;
    case "destroyed":
      label = t("connection.idle");
      cls = "bg-border text-text-t3";
      break;
    case "idle":
    default:
      label = t("connection.idle");
      cls = "bg-border text-text-t3";
      break;
  }

  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-2xs tracking-wider ${cls}`}
      title={`${t("connection.tooltipPrefix")}${status}`}
    >
      {label}
    </span>
  );
}
