/**
 * PLAYWRIGHT CONFIG — E2E test koşumu.
 *
 * Kullanım:
 *   npm run e2e         (headless)
 *   npm run e2e:ui      (UI mode, debug için)
 *
 * Playwright `npm run dev` başlatır, port 3000'i bekler, testleri koşar.
 * Lokal + CI uyumlu.
 *
 * NOT: ilk kurulumda `npx playwright install chromium` çalıştır.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  // E2E testleri sadece bu klasörden
  testDir: "./e2e",
  // Test dosyaları .spec.ts uzantılı
  testMatch: /.*\.spec\.ts$/,

  // Paralel koşum
  fullyParallel: true,

  // CI'da retry, lokal'de yok
  retries: process.env.CI ? 2 : 0,

  // CI'da daha fazla worker
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    // Hata olduğunda screenshot + trace
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    // Web requestler için timeout
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  // Otomatik dev server başlat
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },

  // Test projeleri — şu an sadece chromium
  // (firefox/webkit gelecekte eklenebilir)
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
