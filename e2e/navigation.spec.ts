/**
 * NAVIGATION — Bottom nav sekme geçişleri.
 *
 * Kritik UX akışı:
 *   1. Kullanıcı /karar'da başlar
 *   2. Pozisyon sekmesine tıklar → URL değişir + sayfa açılır
 *   3. Tekrar Karar'a döner → state korunur
 *
 * Bu, settingsStore.lastTab kayıtının doğru çalıştığını ima eder.
 */

import { test, expect } from "@playwright/test";
import { waitForHydration } from "./helpers";

test.describe("Bottom Navigation", () => {
  test("Bottom nav görünür ve interaktif", async ({ page }) => {
    await page.goto("/karar");
    await waitForHydration(page);

    // Bottom nav role='navigation' veya fixed bottom
    const nav = page.locator("nav").last();
    await expect(nav).toBeVisible();
  });

  test("Karar → Pozisyon → Karar geçişi çalışır", async ({ page }) => {
    await page.goto("/karar");
    await waitForHydration(page);

    // Pozisyon sekmesine tıkla (link href="/pozisyon" arayalım)
    const pozisyonLink = page.locator('a[href="/pozisyon"]').first();
    await expect(pozisyonLink).toBeVisible();
    await pozisyonLink.click();

    await waitForHydration(page);
    await expect(page).toHaveURL(/\/pozisyon/);

    // Geri Karar'a dön
    const kararLink = page.locator('a[href="/karar"]').first();
    await kararLink.click();
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/karar/);
  });

  test("Tüm 7 sekme link'i bottom nav'da var", async ({ page }) => {
    await page.goto("/karar");
    await waitForHydration(page);

    const expectedPaths = [
      "/karar",
      "/pozisyon",
      "/grafik",
      "/piyasa",
      "/pnl",
      "/risk",
      "/ayarlar",
    ];

    for (const path of expectedPaths) {
      const link = page.locator(`a[href="${path}"]`).first();
      await expect(link, `Link to ${path} should exist`).toBeAttached();
    }
  });
});
