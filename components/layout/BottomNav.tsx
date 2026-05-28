"use client";

/**
 * BOTTOM NAV — Sticky alt navigasyon bar.
 *
 * Panel v55.51 mobile design ile uyumlu:
 *   - Alt sabit (fixed bottom)
 *   - 7 sekme (Karar, Pozisyon, Grafik, Piyasa, Risk, P&L, Ayarlar)
 *   - Aktif sekme turuncu vurgu (#FF6B1A)
 *   - Emoji ikon + 2 satır kısa text
 *   - Tap area 64px (Apple HIG min target)
 *
 * Tab değişiminde `settingsStore.setLastTab` çağrılır → localStorage'a yazılır.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TABS } from "@/lib/nav/tabs";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useHydrated } from "@/lib/store/hydration";
import { useT } from "@/lib/i18n/context";

export function BottomNav(): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const setLastTab = useSettingsStore((s) => s.setLastTab);
  const hydrated = useHydrated();
  const t = useT();

  return (
    <nav
      className="border-border bg-bg fixed bottom-0 left-0 right-0 z-40 border-t"
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label={t("nav.ariaLabel")}
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-7 px-1">
        {TABS.map((tab) => {
          const active = pathname === tab.path;
          return (
            <li key={tab.id}>
              <Link
                href={tab.path}
                prefetch={false}
                onClick={() => {
                  if (hydrated) setLastTab(tab.id);
                }}
                className={[
                  "flex h-16 flex-col items-center justify-center gap-1",
                  "select-none transition-colors",
                  active
                    ? "text-brand"
                    : "text-text-t3 hover:text-text-t2 active:text-brand",
                ].join(" ")}
                aria-current={active ? "page" : undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  router.refresh();
                }}
              >
                <span className="text-base leading-none" aria-hidden>
                  {tab.icon}
                </span>
                <span className="font-mono text-2xs tracking-wider">
                  {t(tab.shortKey)}
                </span>
                {active && (
                  <span
                    className="bg-brand absolute top-0 h-0.5 w-8 rounded-b-full"
                    aria-hidden
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
