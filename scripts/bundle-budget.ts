/**
 * BUNDLE BUDGET CHECKER — Build sonrası bundle size sertifikası.
 *
 * Kullanım:
 *   npm run perf:check        (build + parse + check)
 *
 * Mantık:
 *   1. `next build` çalıştır (yeniden, fresh stdout için)
 *   2. Stdout'tan route metric'lerini parse et
 *   3. checkBudget() ile threshold'lara karşı kontrol et
 *   4. Sonuç fail → exit code 1 (CI'de build fail)
 *
 * Bütçe ihlali = bilinçli karar gerektirir:
 *   - Optimizasyonla düşür VEYA
 *   - lib/perf/metrics.ts'deki threshold'ları yükselt + BUG_LOG'a not
 */

import { execSync } from "node:child_process";
import {
  parseBuildOutput,
  checkBudget,
  formatBudgetReport,
} from "../lib/perf/metrics";

function main(): void {
  console.log("Running next build for bundle analysis...");

  let stdout: string;
  try {
    stdout = execSync("npx next build", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, NODE_ENV: "production" },
    });
  } catch (err) {
    console.error("✗ Build failed");
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(2);
  }

  const parsed = parseBuildOutput(stdout);
  if (parsed.routes.length === 0) {
    console.error("✗ Could not parse build output");
    console.error("stdout sample:", stdout.slice(-2000));
    process.exit(2);
  }

  const result = checkBudget(parsed.routes, parsed.sharedFirstLoadKb);
  console.log(formatBudgetReport(result));

  process.exit(result.passed ? 0 : 1);
}

main();
