/**
 * E2E HELPERS — Ortak Playwright yardımcıları.
 *
 * - waitForHydration: Next hydration tamamlanana kadar bekle
 * - clearStorage: Test başında localStorage temizle (önceki test artığı kalmasın)
 */

import type { Page } from "@playwright/test";

/**
 * Next.js hydration tamamlanmasını bekle.
 * useHydrated hook'u client'a geldiğinde true olur,
 * o ana kadar skeleton/loading durumu gösterilir.
 *
 * Heuristik: sayfa stabil olana kadar bekle (network idle + 200ms).
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // Hydration sonrası küçük bir bekleme — useEffect tetiklemeleri
  await page.waitForTimeout(200);
}

/**
 * Local storage'ı temizle — her test başında kullan.
 * Önceki testten kalan ug52_* key'leri kalmasın.
 */
export async function clearStorage(page: Page): Promise<void> {
  await page.context().clearCookies();
  // localStorage clear için sayfaya navigate edip JS koş
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

/**
 * Bottom nav sekmesini aç + hydration bekle.
 */
export async function navigateToTab(
  page: Page,
  tabPath: string,
): Promise<void> {
  await page.goto(tabPath);
  await waitForHydration(page);
}
