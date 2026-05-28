"use client";

/**
 * APP HEADER — Sticky üst bar.
 *
 * Panel v55.51 mobile design ile uyumlu:
 *   - Sticky top (sticky top-0)
 *   - Sol: QUANTIX BrandHeader (logo + isim + tagline)
 *   - Sağ: Demo/Forward Test rozet + ConnectionBadge
 */

import { useSettingsStore } from "@/lib/store/settingsStore";
import { useHydrated } from "@/lib/store/hydration";
import { useT } from "@/lib/i18n/context";
import { ConnectionBadge } from "./ConnectionBadge";
import { BrandHeader } from "@/components/brand/BrandHeader";

export function AppHeader(): React.ReactElement {
  const hydrated = useHydrated();
  const demoMode = useSettingsStore((s) => s.demoMode);
  const forwardTestMode = useSettingsStore((s) => s.forwardTestMode);
  const t = useT();

  return (
    <header
      className="border-border bg-bg/80 sticky top-0 z-30 border-b backdrop-blur-md"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        boxShadow: "0 1px 0 0 rgba(195, 85, 35, 0.08), 0 8px 24px -12px rgba(82, 35, 135, 0.20)",
      }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <BrandHeader />
        <div className="flex items-center gap-2">
          <ConnectionBadge />
          {hydrated && (
            <>
              {demoMode && (
                <span className="bg-soft-blue text-signal-blue rounded px-2 py-0.5 font-mono text-2xs tracking-wider">
                  {t("app.demo")}
                </span>
              )}
              {forwardTestMode && (
                <span className="bg-soft-amber text-signal-amber rounded px-2 py-0.5 font-mono text-2xs tracking-wider">
                  {t("app.forwardTest")}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
