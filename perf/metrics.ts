/**
 * PERFORMANCE BUDGETS — Bundle size sertifikası.
 *
 * Bu modül saf hesap. Production build sonrası çağrılır:
 *   - .next/build manifestinden veya next build stdout'tan size'lar parse
 *   - Threshold'la karşılaştır → ihlal varsa fail
 *
 * Mantık:
 *   - Shared first load: HER sayfada yüklenir → tight budget
 *   - Per-route: 'karar' gibi şişman olabilir ama hala üst sınır var
 *
 * Threshold'lar gerçek ölçüm sonuçlarına göre ayarlandı (paket #17 mevcut):
 *   Shared: 105 kB → budget 120 kB (15 kB tolerans)
 *   Karar: 16.4 kB → budget 25 kB
 *   Diğer routes: 4-7 kB → budget 15 kB
 *
 * Bütçe aşılırsa: ya optimizasyon ya bilinçli artırma (BUG_LOG'a not).
 */

/** Maksimum kabul edilen route size'ları (kB cinsinden) */
export const ROUTE_BUDGETS_KB: Record<string, number> = {
  // Static pages (size sütunu — sadece o sayfanın JS'i)
  "/karar": 25,
  "/pozisyon": 15,
  "/grafik": 15,
  "/piyasa": 15,
  "/pnl": 15,
  "/risk": 15,
  "/ayarlar": 15,
  // Root sayfa boş redirect
  "/": 5,
};

/** Shared first-load JS — tüm sayfalarda yüklenir, sıkı kontrol */
export const SHARED_FIRST_LOAD_BUDGET_KB = 120;

/**
 * Build output'tan parse edilen tek sayfanın metrik'i.
 */
export interface RouteMetric {
  path: string;
  /** Sayfa-spesifik JS (Size sütunu) */
  sizeKb: number;
  /** İlk yükleme toplam (First Load JS) */
  firstLoadKb: number;
  /** static (○) veya dynamic (ƒ) */
  type: "static" | "dynamic";
}

/**
 * Budget check sonucu.
 */
export interface BudgetCheckResult {
  passed: boolean;
  violations: BudgetViolation[];
  warnings: BudgetViolation[];
  metrics: RouteMetric[];
  sharedFirstLoadKb: number;
}

export interface BudgetViolation {
  path: string;
  metric: "size" | "firstLoad" | "shared";
  actualKb: number;
  budgetKb: number;
  /** actual - budget */
  excessKb: number;
}

/**
 * Verilen metric set'i için budget kontrolü.
 *
 * @param routes Route metric'leri
 * @param sharedKb Shared first-load JS
 * @returns Budget check sonucu (passed = tüm violation'lar 0)
 */
export function checkBudget(
  routes: RouteMetric[],
  sharedKb: number,
): BudgetCheckResult {
  const violations: BudgetViolation[] = [];
  const warnings: BudgetViolation[] = [];

  // Shared budget kontrolü
  if (sharedKb > SHARED_FIRST_LOAD_BUDGET_KB) {
    violations.push({
      path: "(shared)",
      metric: "shared",
      actualKb: sharedKb,
      budgetKb: SHARED_FIRST_LOAD_BUDGET_KB,
      excessKb: sharedKb - SHARED_FIRST_LOAD_BUDGET_KB,
    });
  } else if (sharedKb > SHARED_FIRST_LOAD_BUDGET_KB * 0.9) {
    // %90 doluluk → warning
    warnings.push({
      path: "(shared)",
      metric: "shared",
      actualKb: sharedKb,
      budgetKb: SHARED_FIRST_LOAD_BUDGET_KB,
      excessKb: sharedKb - SHARED_FIRST_LOAD_BUDGET_KB,
    });
  }

  // Per-route budget
  for (const route of routes) {
    const budget = ROUTE_BUDGETS_KB[route.path];
    if (budget === undefined) continue; // tanımsız route — atla

    if (route.sizeKb > budget) {
      violations.push({
        path: route.path,
        metric: "size",
        actualKb: route.sizeKb,
        budgetKb: budget,
        excessKb: route.sizeKb - budget,
      });
    } else if (route.sizeKb > budget * 0.9) {
      warnings.push({
        path: route.path,
        metric: "size",
        actualKb: route.sizeKb,
        budgetKb: budget,
        excessKb: route.sizeKb - budget,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    metrics: routes,
    sharedFirstLoadKb: sharedKb,
  };
}

/**
 * Next build stdout output'unu parse et.
 *
 * Format örnek satır:
 *   "├ ○ /karar                               16.4 kB         144 kB"
 *   "├ ƒ /api/okx/check                       150 B           106 kB"
 *
 * @returns route metric array + shared kb (yoksa 0)
 */
export interface ParsedBuildOutput {
  routes: RouteMetric[];
  sharedFirstLoadKb: number;
}

export function parseBuildOutput(stdout: string): ParsedBuildOutput {
  const routes: RouteMetric[] = [];
  let sharedFirstLoadKb = 0;

  const lines = stdout.split("\n");
  for (const line of lines) {
    // Path satırı? "├ ○ /karar  16.4 kB  144 kB" veya "┌ ○ /  150 B  106 kB"
    // ○ = static, ƒ = dynamic
    // Path: / veya /xyz veya /api/[...path]
    const routeMatch = line.match(
      /^[┌├└]\s+([○ƒ])\s+(\/[\/_a-zA-Z0-9.\[\]\-]*)\s+([\d.]+)\s*(B|kB|MB)\s+([\d.]+)\s*(B|kB|MB)/,
    );
    if (routeMatch) {
      const [, typeChar, path, sizeStr, sizeUnit, firstStr, firstUnit] =
        routeMatch;
      routes.push({
        path,
        sizeKb: toKb(parseFloat(sizeStr), sizeUnit),
        firstLoadKb: toKb(parseFloat(firstStr), firstUnit),
        type: typeChar === "○" ? "static" : "dynamic",
      });
      continue;
    }

    // Shared satırı? "+ First Load JS shared by all  105 kB"
    const sharedMatch = line.match(
      /First Load JS shared by all\s+([\d.]+)\s*(B|kB|MB)/,
    );
    if (sharedMatch) {
      const [, sizeStr, unit] = sharedMatch;
      sharedFirstLoadKb = toKb(parseFloat(sizeStr), unit);
    }
  }

  return { routes, sharedFirstLoadKb };
}

/** B/kB/MB → kB normalize */
function toKb(value: number, unit: string): number {
  switch (unit) {
    case "B":
      return value / 1024;
    case "kB":
      return value;
    case "MB":
      return value * 1024;
    default:
      return value;
  }
}

/**
 * Pretty-print budget check sonucu (CLI için).
 */
export function formatBudgetReport(result: BudgetCheckResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== BUNDLE BUDGET REPORT ===");
  lines.push("");
  lines.push(`Shared first-load: ${result.sharedFirstLoadKb.toFixed(1)} kB / ${SHARED_FIRST_LOAD_BUDGET_KB} kB`);
  lines.push("");
  lines.push("Per-route sizes (Size column):");
  for (const m of result.metrics) {
    const budget = ROUTE_BUDGETS_KB[m.path];
    const flag =
      budget !== undefined && m.sizeKb > budget
        ? "✗"
        : budget !== undefined && m.sizeKb > budget * 0.9
          ? "⚠"
          : "✓";
    const budgetStr = budget !== undefined ? `${budget} kB` : "—";
    lines.push(
      `  ${flag} ${m.path.padEnd(20)} ${m.sizeKb.toFixed(1).padStart(6)} kB (budget: ${budgetStr})`,
    );
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("⚠ WARNINGS (>90% budget):");
    for (const w of result.warnings) {
      lines.push(
        `  ${w.path}: ${w.actualKb.toFixed(1)} kB / ${w.budgetKb} kB`,
      );
    }
  }

  if (result.violations.length > 0) {
    lines.push("");
    lines.push("✗ VIOLATIONS:");
    for (const v of result.violations) {
      lines.push(
        `  ${v.path}: ${v.actualKb.toFixed(1)} kB / ${v.budgetKb} kB (${v.excessKb.toFixed(1)} kB over)`,
      );
    }
  }

  lines.push("");
  lines.push(result.passed ? "✓ PASSED" : "✗ FAILED");
  return lines.join("\n");
}
