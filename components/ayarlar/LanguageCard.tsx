"use client";

/**
 * LANGUAGE CARD — Arayüz dili seçici.
 *
 * EN / TR arasında geçiş. Seçim localStorage'a persist edilir.
 */

import { useT, useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/types";

const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "tr", label: "Türkçe", flag: "🇹🇷" },
];

export function LanguageCard(): React.ReactElement {
  const t = useT();
  const { locale, setLocale } = useI18n();

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3">
        <div className="text-text-t1 font-mono text-sm font-medium">
          {t("settings.language.label")}
        </div>
        <div className="text-text-t3 mt-0.5 font-mono text-2xs">
          {t("settings.language.description")}
        </div>
      </div>
      <div className="flex gap-2">
        {LOCALES.map((l) => (
          <button
            key={l.value}
            type="button"
            onClick={() => setLocale(l.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded border py-1.5 font-mono text-xs font-medium tracking-wider transition-colors ${
              locale === l.value
                ? "border-text-t1 bg-surface-s2 text-text-t1"
                : "border-border text-text-t3 hover:text-text-t2"
            }`}
          >
            <span>{l.flag}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
