/**
 * NAV — Sekme konfigürasyonu (saf veri).
 *
 * 7 sekme — panel mobil tasarımıyla birebir:
 *   Decision/Karar, Position/Pozisyon, Chart/Grafik, Market/Piyasa,
 *   Risk, P&L, Settings/Ayarlar
 *
 * Bu sabit panel v55.51'in `validTabs` listesinden geliyor (satır 10001).
 *
 * i18n: label/short artık dictionary key (nav.decision, nav.decisionShort vs.)
 * Components useT() ile çevirir.
 */

import type { TabId } from "@/lib/store/settingsStore";

export interface TabConfig {
  id: TabId;
  /** URL pathi: /karar, /pozisyon, vs. (URL'ler TR'de kaldı — backward compat) */
  path: string;
  /** i18n key — full label */
  labelKey: string;
  /** i18n key — kısa label (mobile nav) */
  shortKey: string;
  /** Emoji ikon (panel uyumlu) */
  icon: string;
}

export const TABS: readonly TabConfig[] = [
  {
    id: "karar",
    path: "/karar",
    labelKey: "nav.decision",
    shortKey: "nav.decisionShort",
    icon: "🎯",
  },
  {
    id: "pozisyon",
    path: "/pozisyon",
    labelKey: "nav.position",
    shortKey: "nav.positionShort",
    icon: "💼",
  },
  {
    id: "grafik",
    path: "/grafik",
    labelKey: "nav.chart",
    shortKey: "nav.chart",
    icon: "📈",
  },
  {
    id: "piyasa",
    path: "/piyasa",
    labelKey: "nav.market",
    shortKey: "nav.market",
    icon: "🌐",
  },
  {
    id: "risk",
    path: "/risk",
    labelKey: "nav.risk",
    shortKey: "nav.risk",
    icon: "🛡️",
  },
  {
    id: "pnl",
    path: "/pnl",
    labelKey: "nav.pnl",
    shortKey: "nav.pnl",
    icon: "💰",
  },
  {
    id: "ayarlar",
    path: "/ayarlar",
    labelKey: "nav.settings",
    shortKey: "nav.settingsShort",
    icon: "⚙️",
  },
] as const;

/**
 * Path → TabConfig haritası.
 */
export function getTabByPath(path: string): TabConfig | undefined {
  return TABS.find((t) => t.path === path);
}

/**
 * TabId → TabConfig haritası.
 */
export function getTabById(id: TabId): TabConfig | undefined {
  return TABS.find((t) => t.id === id);
}
