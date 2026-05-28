/**
 * SMOKE PROD — Production URL'ine karşı sağlık kontrolü.
 *
 * Kullanım:
 *   npm run smoke -- https://quantix.example.com
 *   npm run smoke                                  (NEXT_PUBLIC_APP_URL env'den)
 *
 * Tüm SMOKE_CHECKS endpoint'lerini fetch'ler, evaluateSmokeResponse ile yargılar,
 * formatSmokeReport ile CLI'a basar. Tek bir fail = exit 1.
 *
 * CI'da: deploy sonrası bu script koşar; fail → rollback tetiklenebilir.
 */

import {
  SMOKE_CHECKS,
  evaluateSmokeResponse,
  formatSmokeReport,
  normalizeBaseUrl,
  type SmokeReport,
  type SmokeResult,
} from "../lib/deploy/smoke";

async function main(): Promise<void> {
  // URL: arg veya env
  const argUrl = process.argv[2];
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  const rawUrl = argUrl ?? envUrl;

  if (!rawUrl) {
    console.error(
      "✗ Usage: npm run smoke -- <url>   OR   set NEXT_PUBLIC_APP_URL",
    );
    process.exit(2);
  }

  const baseUrl = normalizeBaseUrl(rawUrl);
  console.log(`Smoke testing ${baseUrl}...`);
  console.log("");

  const startedAt = Date.now();
  const results: SmokeResult[] = [];

  for (const check of SMOKE_CHECKS) {
    const url = `${baseUrl}${check.path}`;
    const method = check.method ?? "GET";
    const t0 = Date.now();
    try {
      const res = await fetch(url, { method, redirect: "manual" });
      const responseTimeMs = Date.now() - t0;
      // Body sadece expectBody varsa oku (büyük HTML için optimize)
      let body = "";
      if (check.expectBody) {
        body = await res.text();
      }
      const result = evaluateSmokeResponse(
        check,
        res.status,
        body,
        responseTimeMs,
      );
      results.push(result);
    } catch (err) {
      const responseTimeMs = Date.now() - t0;
      results.push({
        check,
        ok: false,
        responseTimeMs,
        errorMessage: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }

  const finishedAt = Date.now();
  const report: SmokeReport = {
    baseUrl,
    startedAt,
    finishedAt,
    totalChecks: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };

  console.log(formatSmokeReport(report));
  process.exit(report.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(2);
});
