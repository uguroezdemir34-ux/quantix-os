"use client";

/**
 * I18N CONTEXT — Locale state + translate hook.
 *
 * Kullanım:
 *   const { t, locale, setLocale } = useI18n();
 *   t("nav.decision");           → "Decision" / "Karar"
 *   t("confirm.disclaimer3", { pct: "0.5" }); → "Risk capped at 0.5%"
 *
 * SSR-safe: server'da default locale (en), client mount'ta localStorage'tan
 * gerçek locale yüklenir.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Locale } from "./types";
import { DEFAULT_LOCALE } from "./types";
import { DICTIONARIES, detectLocale, persistLocale, translate } from "./dict";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
  hydrated: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  // SSR: DEFAULT_LOCALE (en) ile başla, mount sonrası gerçek locale
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  // Client mount: locale tespit + state güncelle
  useEffect(() => {
    const detected = detectLocale();
    if (detected !== locale) {
      setLocaleState(detected);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    persistLocale(newLocale);
  }, []);

  const t = useCallback(
    (path: string, params?: Record<string, string | number>) => {
      return translate(DICTIONARIES[locale], path, params);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, hydrated }),
    [locale, setLocale, t, hydrated],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Tam i18n context (locale + setLocale + t + hydrated) */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}

/** Sadece translate fonksiyonu (en yaygın kullanım) */
export function useT(): I18nContextValue["t"] {
  return useI18n().t;
}

/** Sadece locale */
export function useLocale(): Locale {
  return useI18n().locale;
}
