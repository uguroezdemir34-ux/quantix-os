/**
 * SMOKE TEST — En temel: her sayfa açılıyor mu, çökmüyor mu?
 *
 * Bu testler her commit'te koşmalı — production-blocker hatalar.
 * Hiçbir spesifik içerik aranmıyor, sadece "render edildi mi?".
 */

import { test, expect } from "@playwright/test";
import { waitForHydration } from "./helpers";

const TABS = [
  { path: "/karar", name: "Karar (Decision)" },
  { path: "/pozisyon", name: "Pozisyon (Positions)" },
  { path: "/grafik", name: "Grafik (Chart)" },
  { path: "/piyasa", name: "Piyasa (Market)" },
  { path: "/pnl", name: "P&L" },
  { path: "/risk", name: "Risk" },
  { path: "/ayarlar", name: "Ayarlar (Settings)" },
];

test.describe("Smoke — tüm sayfalar açılıyor", () => {
  for (const tab of TABS) {
    test(`${tab.name} sayfası render edilir`, async ({ page }) => {
      await page.goto(tab.path);
      await waitForHydration(page);
      // Header görünür
      await expect(page.locator("header")).toBeVisible();
      // Hiç error overlay yok
      const errorBox = page.locator("[data-nextjs-dialog]");
      await expect(errorBox).not.toBeVisible();
    });
  }

  test("/ root URL → /karar'a yönlendirir veya açılır", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    // Header görünür
    await expect(page.locator("header")).toBeVisible();
  });

  test("QUANTIX marka adı header'da görünür", async ({ page }) => {
    await page.goto("/karar");
    await waitForHydration(page);
    await expect(page.getByText("QUANTIX").first()).toBeVisible();
  });

  test("QUANTIX logo render edilir", async ({ page }) => {
    await page.goto("/karar");
    await waitForHydration(page);
    const logo = page.getByAltText("QUANTIX").first();
    await expect(logo).toBeVisible();
  });
});
