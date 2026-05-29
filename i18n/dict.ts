/**
 * I18N DICT — Locale → Dictionary mapping ve helper'lar.
 */

import type { Dictionary, Locale } from "./types";
import { en } from "./en";
import { tr } from "./tr";

export const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  tr,
};

/**
 * Dot-notation path → nested value.
 *
 * @example
 *   getNested(dict, "nav.decision") → "Decision" / "Karar"
 */
function getNested(obj: unknown, path: string): string {
  const keys = path.split(".");
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in cur) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return path; // fallback: key'i göster (developer için debug)
    }
  }
  return typeof cur === "string" ? cur : path;
}

/**
 * Template string'lerde {placeholder} değerleri.
 *
 * @example
 *   interpolate("Need ${n} USD", { n: "100" }) → "Need 100 USD"
 *   interpolate("Risk %{pct}", { pct: "0.5" }) → "Risk %0.5"
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let result = template;
  for (const [key, val] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(val));
  }
  return result;
}

/**
 * Translate fonksiyonu.
 * Path yoksa key'i döner (developer için debug, kullanıcı için "nav.decision" görünür).
 */
export function translate(
  dict: Dictionary,
  path: string,
  params?: Record<string, string | number>,
): string {
  const raw = getNested(dict, path);
  return interpolate(raw, params);
}

/**
 * Locale getir (localStorage'tan, yoksa browser language, son fallback default).
 */
export function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem("ug52_locale");
    if (stored === "en" || stored === "tr") return stored;
  } catch {
    // ignore
  }
  // Browser language fallback
  if (typeof navigator !== "undefined") {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("tr")) return "tr";
  }
  return "en";
}

/** Locale persist */
export function persistLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("ug52_locale", locale);
  } catch {
    // ignore
  }
}
