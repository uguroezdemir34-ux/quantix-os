"use client";

/**
 * BLOCKS LIST — Aktif block'ları görüntüler.
 *
 * Hard blocks: kırmızı pill ("Counter-trend", "BTC korelasyon", vs.)
 * Soft blocks: amber pill ("Düşük hacim", vs.)
 * Boş listede: yeşil "Engel yok" rozeti
 *
 * Not: block içerikleri şu an orchestrator'dan ham string olarak geliyor.
 * Faz 2 #11+'da bunlar da i18n key'lerine çevrilecek (paket #6a kapsam dışı).
 */

import { useT } from "@/lib/i18n/context";

export function BlocksList({
  hardBlocks,
  softBlocks,
}: {
  hardBlocks: readonly string[];
  softBlocks: readonly string[];
}): React.ReactElement {
  const t = useT();
  const empty = hardBlocks.length === 0 && softBlocks.length === 0;

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t3 mb-3 font-mono text-2xs tracking-widest">
        {t("blocks.title")}
      </h3>
      {empty ? (
        <div className="bg-soft-green text-signal-green inline-flex items-center gap-1.5 rounded-md border border-signal-green/40 px-2 py-1 font-mono text-xs tracking-wider">
          <span>✓</span>
          <span>{t("blocks.noBlocks")}</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hardBlocks.map((b, i) => (
            <span
              key={`h${i}`}
              className="bg-soft-red text-signal-red border-signal-red/40 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-2xs tracking-wider"
            >
              <span>❌</span>
              <span>{b}</span>
            </span>
          ))}
          {softBlocks.map((b, i) => (
            <span
              key={`s${i}`}
              className="bg-soft-amber text-signal-amber border-signal-amber/40 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-2xs tracking-wider"
            >
              <span>⚠</span>
              <span>{b}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
