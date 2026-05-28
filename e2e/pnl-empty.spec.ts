/**
 * P&L — Boş durum testi.
 *
 * Yeni kullanıcı (hiç trade yok) → empty state mesajı görünmeli.
 * Bu, boş veriyle çökmeden çalışmayı garantiler.
 */

import { test, expect } from "@playwright/test";
import { waitForHydration, clearStorage } from "./helpers";

test.describe("P&L sayfası", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test("Hiç trade yokken empty state gösterilir", async ({ page }) => {
    await page.goto("/pnl");
    await waitForHydration(page);

    // Sayfa render edildi
    await expect(page.locator("header")).toBeVisible();

    // Empty state mesajı: "No trades yet" veya "Henüz trade yok"
    const emptyMessage = page
      .getByText(/No trades yet|Henüz trade yok/i)
      .first();
    await expect(emptyMessage).toBeVisible();
  });

  test("P&L title görünür", async ({ page }) => {
    await page.goto("/pnl");
    await waitForHydration(page);
    // 💰 emoji + title
    const title = page.getByText(/💰/).first();
    await expect(title).toBeVisible();
  });
});

test.describe("Pozisyon sayfası — empty timeline", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
  });

  test("Hiç trade yokken timeline empty state", async ({ page }) => {
    await page.goto("/pozisyon");
    await waitForHydration(page);

    // TradeTimelineCard empty: "No trades yet"
    const emptyMessage = page
      .getByText(/No trades yet|Henüz trade yok/i)
      .first();
    await expect(emptyMessage).toBeVisible();
  });
});
