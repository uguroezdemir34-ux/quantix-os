"use client";

/**
 * POSITION EMPTY STATE — Açık pozisyon yokken gösterilen kart.
 */

import { useT } from "@/lib/i18n/context";

export function PositionEmptyState(): React.ReactElement {
  const t = useT();
  return (
    <div className="border-border bg-bg-card rounded-lg border p-8 text-center">
      <span className="mb-3 block text-5xl opacity-50" aria-hidden>
        💤
      </span>
      <h3 className="text-text-t1 font-mono text-sm tracking-widest">
        {t("position.emptyTitle")}
      </h3>
      <p className="text-text-t3 mx-auto mt-2 max-w-xs text-xs leading-relaxed">
        {t("position.emptyDescription")}
      </p>
    </div>
  );
}
