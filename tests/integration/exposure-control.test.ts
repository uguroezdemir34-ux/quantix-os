/**
 * EXPOSURE CONTROL — Kümülatif Risk Yoğunlaşma Filtresi Test Suite
 *
 * 45+ test case kapsamı:
 *   1.  computeTotalMargin / computeDirectionalMargin yardımcıları
 *   2.  checkExposure — temel karar matrisi (allowed / scaled_down / blocked)
 *   3.  TotalExposureCap — kümülatif margin toplam sınırı
 *   4.  DirectionalExposureCap — tek yön sınırı
 *   5.  ScaleDown — kısma lojiği + oranı
 *   6.  MinMargin eşiği — kısma sonrası çok küçükse bloke
 *   7.  Equity sıfır/negatif guard
 *   8.  applyScaleFactorToQty / marginToQty / qtyToMargin dönüşümleri
 *   9.  computeExposureSummary — dashboard özeti
 *  10.  Preflight entegrasyonu — blocked_exposure kararı
 *  11.  Tam senaryo: BTC LONG açık + ETH LONG talebi → scale / bloke
 *  12.  Konfig override testleri
 */

import { describe, it, expect } from "vitest";
import {
  checkExposure,
  computeTotalMargin,
  computeDirectionalMargin,
  computeExposureSummary,
  applyScaleFactorToQty,
  marginToQty,
  qtyToMargin,
  DEFAULT_EXPOSURE_CONFIG,
} from "@/lib/risk/exposure";
import type { ExposurePosition, ExposureConfig } from "@/lib/risk/exposure";
import { runPreflightChecks } from "@/lib/orchestrator/preflight";
import type { OrchestrateInput } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makePos(
  pair: ExposurePosition["pair"],
  direction: "LONG" | "SHORT",
  marginUsd: number,
  status: "open" | "pending" = "open",
): ExposurePosition {
  return { pair, direction, marginUsd, status };
}

const EQUITY = 10_000; // $10,000 baseline equity

// Default config limits:
// totalCap  = 10000 × 0.25 = $2500
// dirCap    = 10000 × 0.20 = $2000

// ─────────────────────────────────────────────────────────────
// 1. computeTotalMargin
// ─────────────────────────────────────────────────────────────

describe("computeTotalMargin()", () => {
  it("boş liste → 0", () => {
    expect(computeTotalMargin([])).toBe(0);
  });

  it("tek açık pozisyon → marjini döner", () => {
    expect(computeTotalMargin([makePos("BTC", "LONG", 500)])).toBe(500);
  });

  it("birden fazla açık → toplamlarını döner", () => {
    const positions = [
      makePos("BTC", "LONG", 500),
      makePos("ETH", "SHORT", 300),
    ];
    expect(computeTotalMargin(positions)).toBe(800);
  });

  it("pending pozisyon dahil edilir", () => {
    const positions = [
      makePos("BTC", "LONG", 500, "open"),
      makePos("ETH", "LONG", 200, "pending"),
    ];
    expect(computeTotalMargin(positions)).toBe(700);
  });

  it("negatif margin 0 olarak sayılır (guard)", () => {
    const positions = [makePos("BTC", "LONG", -100), makePos("ETH", "SHORT", 200)];
    expect(computeTotalMargin(positions)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. computeDirectionalMargin
// ─────────────────────────────────────────────────────────────

describe("computeDirectionalMargin()", () => {
  it("sadece LONG'ları toplar", () => {
    const positions = [
      makePos("BTC", "LONG", 500),
      makePos("ETH", "SHORT", 300),
      makePos("BTC", "LONG", 200),
    ];
    expect(computeDirectionalMargin(positions, "LONG")).toBe(700);
  });

  it("sadece SHORT'ları toplar", () => {
    const positions = [
      makePos("BTC", "LONG", 500),
      makePos("ETH", "SHORT", 300),
    ];
    expect(computeDirectionalMargin(positions, "SHORT")).toBe(300);
  });

  it("yön eşleşmezse 0", () => {
    expect(computeDirectionalMargin([makePos("BTC", "LONG", 500)], "SHORT")).toBe(0);
  });

  it("boş liste → 0", () => {
    expect(computeDirectionalMargin([], "LONG")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. checkExposure — Temel Karar Matrisi
// ─────────────────────────────────────────────────────────────

describe("checkExposure() — allowed (kısıtsız)", () => {
  it("ilk pozisyon, limit içinde → allowed", () => {
    const result = checkExposure(500, "LONG", EQUITY, []);
    expect(result.verdict).toBe("allowed");
    expect(result.scaleFactor).toBe(1.0);
    expect(result.allowedMarginUsd).toBe(500);
  });

  it("tam sınırın bir altı → allowed", () => {
    // totalCap = 2500; 2 açık (1000 LONG, 1000 SHORT) + 499 LONG talebi < 2500 toplam
    const positions = [makePos("BTC", "LONG", 1000), makePos("ETH", "SHORT", 1000)];
    const result = checkExposure(499, "LONG", EQUITY, positions);
    // totalRoom = 2500 - 2000 = 500; directionalRoom = 2000 - 1000 = 1000; 499 < min(500,1000)
    expect(result.verdict).toBe("allowed");
  });

  it("açık pozisyon yok → allowed tam boyut", () => {
    const result = checkExposure(2000, "LONG", EQUITY, []);
    // totalRoom = 2500; directionalRoom = 2000; request 2000 ≤ min(2500,2000)
    expect(result.verdict).toBe("allowed");
    expect(result.allowedMarginUsd).toBe(2000);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. TotalExposureCap — Toplam Kümülatif Sınır
// ─────────────────────────────────────────────────────────────

describe("TotalExposureCap (%25 equity)", () => {
  it("toplam cap doluysa yeni pozisyon bloke", () => {
    // BTC LONG 1500 + ETH SHORT 1000 = 2500 = cap → 0 yer kalmadı
    const positions = [
      makePos("BTC", "LONG", 1500),
      makePos("ETH", "SHORT", 1000),
    ];
    const result = checkExposure(100, "SHORT", EQUITY, positions);
    expect(result.verdict).toBe("blocked");
    expect(result.allowedMarginUsd).toBe(0);
  });

  it("toplam cap aşılmışsa (başka yoldan) → bloke", () => {
    // 3000 > 2500 cap
    const positions = [makePos("BTC", "LONG", 3000)];
    const result = checkExposure(100, "SHORT", EQUITY, positions);
    expect(result.verdict).toBe("blocked");
  });

  it("talep toplam cap'i aşıyor → scale_down", () => {
    // Mevcut: 1500 LONG + 500 SHORT = 2000 toplam → 500 yer var
    // Talep: 800 → kısılmalı
    const positions = [
      makePos("BTC", "LONG", 1500),
      makePos("ETH", "SHORT", 500),
    ];
    const result = checkExposure(800, "SHORT", EQUITY, positions);
    expect(result.verdict).toBe("scaled_down");
    expect(result.allowedMarginUsd).toBeCloseTo(500, 1);
  });

  it("diagnostics.totalCapLimitUsd doğru (equity × totalCapPct)", () => {
    const result = checkExposure(100, "LONG", EQUITY, []);
    expect(result.diagnostics.totalCapLimitUsd).toBeCloseTo(EQUITY * 0.25);
  });

  it("farklı equity ile totalCap değişir", () => {
    const equity = 50_000;
    const result = checkExposure(100, "LONG", equity, []);
    // cap = 50000 × 0.25 = 12500
    expect(result.diagnostics.totalCapLimitUsd).toBe(12500);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. DirectionalExposureCap — Tek Yön Sınırı
// ─────────────────────────────────────────────────────────────

describe("DirectionalExposureCap (%20 equity per direction)", () => {
  it("tek yön cap doluysa, aynı yönde yeni pozisyon bloke", () => {
    // directionalCap = 2000; BTC LONG 2000 doldu
    const positions = [makePos("BTC", "LONG", 2000)];
    const result = checkExposure(100, "LONG", EQUITY, positions);
    expect(result.verdict).toBe("blocked");
    expect(result.reason).toContain("cap");
  });

  it("karşı yönde hâlâ yer var → allowed", () => {
    // LONG cap dolu ama SHORT için yer var
    const positions = [makePos("BTC", "LONG", 2000)];
    const result = checkExposure(500, "SHORT", EQUITY, positions);
    // SHORT: directionalRoom = 2000; totalRoom = 2500 - 2000 = 500
    expect(result.verdict).toBe("allowed");
    expect(result.allowedMarginUsd).toBe(500);
  });

  it("yönsel cap'i aşan talep scale_down olur", () => {
    // BTC LONG 1500 → directionalRoom = 500; talep 800
    const positions = [makePos("BTC", "LONG", 1500)];
    const result = checkExposure(800, "LONG", EQUITY, positions);
    expect(result.verdict).toBe("scaled_down");
    expect(result.allowedMarginUsd).toBeCloseTo(500, 1);
  });

  it("diagnostics.directionalCapLimitUsd doğru (equity × directionalCapPct)", () => {
    const result = checkExposure(100, "LONG", EQUITY, []);
    expect(result.diagnostics.directionalCapLimitUsd).toBeCloseTo(EQUITY * 0.20);
  });

  it("LONG ve SHORT bağımsız: her ikisi de %20'ye yakın → both ok", () => {
    const positions = [
      makePos("BTC", "LONG", 1900),
      makePos("ETH", "SHORT", 1900),
    ];
    // totalRoom = 2500 - 3800 → negatif → bloke
    const result = checkExposure(100, "LONG", EQUITY, positions);
    expect(result.verdict).toBe("blocked");
  });
});

// ─────────────────────────────────────────────────────────────
// 6. ScaleDown Lojiği
// ─────────────────────────────────────────────────────────────

describe("ScaleDown — pozisyon kısma", () => {
  it("scaleFactor = allowedMarginUsd / requestedMarginUsd", () => {
    // totalRoom = 500, directionalRoom = 2000 → min = 500; request = 1000
    const positions = [makePos("BTC", "LONG", 2000), makePos("ETH", "SHORT", 0)];
    // total = 2000 → totalRoom = 500; directional SHORT = 0 → directionalRoom = 2000
    const result = checkExposure(1000, "SHORT", EQUITY, positions);
    expect(result.verdict).toBe("scaled_down");
    expect(result.scaleFactor).toBeCloseTo(0.5, 3);
  });

  it("scaleFactor [0,1] aralığında", () => {
    const positions = [makePos("BTC", "LONG", 1500)];
    const result = checkExposure(2000, "LONG", EQUITY, positions);
    expect(result.scaleFactor).toBeGreaterThan(0);
    expect(result.scaleFactor).toBeLessThanOrEqual(1);
  });

  it("tam sığan istek scaleFactor=1.0", () => {
    const result = checkExposure(100, "LONG", EQUITY, []);
    expect(result.scaleFactor).toBe(1.0);
  });

  it("reason alanı kısma yüzdesini içerir", () => {
    const positions = [makePos("BTC", "LONG", 1500)];
    const result = checkExposure(800, "LONG", EQUITY, positions);
    expect(result.reason).toContain("%");
  });

  it("scale down → allowedMarginUsd gerçekten küçük olan limiti yansıtır", () => {
    // totalRoom = 2500 - 1800 = 700; directionalRoom = 2000 - 1800 = 200
    // min = 200 → allowedMarginUsd = 200
    const positions = [makePos("BTC", "LONG", 1800)];
    const result = checkExposure(1000, "LONG", EQUITY, positions);
    expect(result.allowedMarginUsd).toBeCloseTo(200, 1);
    expect(result.verdict).toBe("scaled_down");
  });
});

// ─────────────────────────────────────────────────────────────
// 7. MinMargin Eşiği
// ─────────────────────────────────────────────────────────────

describe("MinMargin eşiği — kısma sonrası çok küçükse bloke", () => {
  it("kısma sonrası < minMarginUsd → blocked (default=5 USDT)", () => {
    // directionalRoom = 2000 - 1997 = 3 → 3 < 5 → blocked
    const positions = [makePos("BTC", "LONG", 1997)];
    const result = checkExposure(500, "LONG", EQUITY, positions);
    expect(result.verdict).toBe("blocked");
    expect(result.allowedMarginUsd).toBe(0);
  });

  it("kısma sonrası = minMarginUsd → scaled_down (sınır dahil değil)", () => {
    // directionalRoom = 2000 - 1995 = 5 → 5 = minMargin → tam sınır
    const positions = [makePos("BTC", "LONG", 1995)];
    const result = checkExposure(500, "LONG", EQUITY, positions, {
      ...DEFAULT_EXPOSURE_CONFIG,
      minMarginUsd: 5,
    });
    expect(result.verdict).toBe("scaled_down");
    expect(result.allowedMarginUsd).toBeCloseTo(5, 1);
  });

  it("özel minMarginUsd=50 → küçük kısma bloke", () => {
    const positions = [makePos("BTC", "LONG", 1970)];
    const config: ExposureConfig = {
      ...DEFAULT_EXPOSURE_CONFIG,
      minMarginUsd: 50,
    };
    const result = checkExposure(500, "LONG", EQUITY, positions, config);
    // directionalRoom = 30 < 50 → blocked
    expect(result.verdict).toBe("blocked");
  });
});

// ─────────────────────────────────────────────────────────────
// 8. Equity Guard
// ─────────────────────────────────────────────────────────────

describe("Equity guard", () => {
  it("equity=0 → blocked", () => {
    const result = checkExposure(100, "LONG", 0, []);
    expect(result.verdict).toBe("blocked");
    expect(result.reason).toContain("sıfır");
  });

  it("equity negatif → blocked", () => {
    const result = checkExposure(100, "LONG", -500, []);
    expect(result.verdict).toBe("blocked");
  });

  it("requestedMargin=0 → blocked", () => {
    const result = checkExposure(0, "LONG", EQUITY, []);
    expect(result.verdict).toBe("blocked");
  });

  it("requestedMargin negatif → blocked", () => {
    const result = checkExposure(-100, "LONG", EQUITY, []);
    expect(result.verdict).toBe("blocked");
  });
});

// ─────────────────────────────────────────────────────────────
// 9. Dönüşüm yardımcıları
// ─────────────────────────────────────────────────────────────

describe("applyScaleFactorToQty()", () => {
  it("scaleFactor=1 → qty aynı", () => {
    expect(applyScaleFactorToQty(2.5, 1.0)).toBe(2.5);
  });

  it("scaleFactor=0 → qty=0", () => {
    expect(applyScaleFactorToQty(2.5, 0)).toBe(0);
  });

  it("scaleFactor=0.5 → qty yarıya düşer", () => {
    expect(applyScaleFactorToQty(2.0, 0.5)).toBeCloseTo(1.0, 5);
  });

  it("scaleFactor<0 → qty=0", () => {
    expect(applyScaleFactorToQty(2.5, -0.5)).toBe(0);
  });

  it("scaleFactor>1 → qty aynı (clamp)", () => {
    expect(applyScaleFactorToQty(2.5, 1.5)).toBe(2.5);
  });
});

describe("marginToQty() / qtyToMargin()", () => {
  it("marginToQty: margin × leverage / price", () => {
    // margin=1000, leverage=10, price=50000 → qty = 10000/50000 = 0.2
    expect(marginToQty(1000, 50000, 10)).toBeCloseTo(0.2, 6);
  });

  it("qtyToMargin: qty × price / leverage", () => {
    expect(qtyToMargin(0.2, 50000, 10)).toBeCloseTo(1000, 4);
  });

  it("round-trip: qty → margin → qty", () => {
    const qty = 0.35;
    const price = 95000;
    const leverage = 5;
    const margin = qtyToMargin(qty, price, leverage);
    const roundTrip = marginToQty(margin, price, leverage);
    expect(roundTrip).toBeCloseTo(qty, 6);
  });

  it("price=0 → marginToQty=0 (guard)", () => {
    expect(marginToQty(1000, 0, 10)).toBe(0);
  });

  it("leverage=0 → qtyToMargin=0 (guard)", () => {
    expect(qtyToMargin(0.5, 50000, 0)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. computeExposureSummary
// ─────────────────────────────────────────────────────────────

describe("computeExposureSummary()", () => {
  it("boş → tüm değerler sıfır", () => {
    const s = computeExposureSummary([], EQUITY);
    expect(s.totalMarginUsd).toBe(0);
    expect(s.longMarginUsd).toBe(0);
    expect(s.shortMarginUsd).toBe(0);
    expect(s.positionCount).toBe(0);
    expect(s.totalCapUtilization).toBe(0);
  });

  it("positionCount açık + pending sayar", () => {
    const positions = [
      makePos("BTC", "LONG", 500, "open"),
      makePos("ETH", "SHORT", 300, "pending"),
    ];
    const s = computeExposureSummary(positions, EQUITY);
    expect(s.positionCount).toBe(2);
  });

  it("totalCapUtilization = totalMargin / (equity × totalCapPct)", () => {
    const positions = [makePos("BTC", "LONG", 1250)];
    const s = computeExposureSummary(positions, EQUITY);
    // totalMargin=1250, cap=2500 → utilization=0.5
    expect(s.totalCapUtilization).toBeCloseTo(0.5);
  });

  it("longCapUtilization doğru hesaplanır", () => {
    const positions = [makePos("BTC", "LONG", 1000)];
    const s = computeExposureSummary(positions, EQUITY);
    // longMargin=1000, directionalCap=2000 → 0.5
    expect(s.longCapUtilization).toBeCloseTo(0.5);
  });

  it("shortCapUtilization bağımsız hesaplanır", () => {
    const positions = [
      makePos("BTC", "LONG", 1000),
      makePos("ETH", "SHORT", 400),
    ];
    const s = computeExposureSummary(positions, EQUITY);
    expect(s.longCapUtilization).toBeCloseTo(0.5);
    expect(s.shortCapUtilization).toBeCloseTo(0.2);
  });

  it("cap %100 doluysa utilization=1.0", () => {
    const positions = [makePos("BTC", "LONG", 2500)];
    const s = computeExposureSummary(positions, EQUITY);
    expect(s.totalCapUtilization).toBeCloseTo(1.0);
  });

  it("cap aşıldıysa utilization>1", () => {
    const positions = [makePos("BTC", "LONG", 3000)];
    const s = computeExposureSummary(positions, EQUITY);
    expect(s.totalCapUtilization).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 11. Preflight Entegrasyonu
// ─────────────────────────────────────────────────────────────

function makePreflightInput(
  overrides: Partial<OrchestrateInput["accountState"]> = {},
  signalOverrides: Partial<OrchestrateInput["signal"]> = {},
): OrchestrateInput {
  return {
    pair: "ETH",
    livePrice: 3000,
    qty: 1.0,       // 1 ETH
    stopPrice: 2900,
    leverage: 5,
    marginMode: "isolated",
    source: "bot",
    signal: {
      verdict: "go",
      direction: "LONG",
      total: 75,
      effectiveThreshold: 60,
      baseScore: 70,
      score: 75,
      scorers: [],
      humanSummary: "test",
      pair: "ETH",
      dirConfidence: 0.8,
      counterTrend: false,
      sub: {} as never,
      blocks: [],
      meta: {} as never,
      ...signalOverrides,
    } as OrchestrateInput["signal"],
    accountState: {
      drawdownProtocol: { tier: "normal", multiplier: 1, label: "Normal" },
      btcCooldownUntil: 0,
      btcSelfCooldownUntil: 0,
      todayTradeCount: 0,
      maxTradesPerDay: 5,
      ...overrides,
    },
  };
}

describe("Preflight entegrasyonu — blocked_exposure", () => {
  it("exposure cap doluysa blocked_exposure kararı", () => {
    // BTC LONG 2500 → cap dolu, ETH LONG talebi bloke
    const positions: ExposurePosition[] = [makePos("BTC", "LONG", 2500)];
    const input = makePreflightInput({
      openPositionsWithMargin: positions,
      equityUsd: EQUITY,
    });
    const result = runPreflightChecks(input, Date.now());
    expect(result.passed).toBe(false);
    expect(result.decision).toBe("blocked_exposure");
  });

  it("exposure bilgisi yoksa exposure kontrolü atlanır (backward compat)", () => {
    const input = makePreflightInput(); // openPositionsWithMargin yok
    const result = runPreflightChecks(input, Date.now());
    // Diğer kontroller geçer → passed
    expect(result.decision).not.toBe("blocked_exposure");
  });

  it("exposure limiti içindeyse diğer checks devam eder", () => {
    const positions: ExposurePosition[] = [makePos("BTC", "LONG", 100)];
    const input = makePreflightInput({
      openPositionsWithMargin: positions,
      equityUsd: EQUITY,
    });
    const result = runPreflightChecks(input, Date.now());
    expect(result.passed).toBe(true);
    expect(result.decision).not.toBe("blocked_exposure");
  });

  it("yönsel cap aşıldığında preflight bloke edilir", () => {
    // directionalCap = 2000; LONG 2000 doldu
    const positions: ExposurePosition[] = [makePos("BTC", "LONG", 2000)];
    const input = makePreflightInput({
      openPositionsWithMargin: positions,
      equityUsd: EQUITY,
    });
    const result = runPreflightChecks(input, Date.now());
    expect(result.passed).toBe(false);
    expect(result.decision).toBe("blocked_exposure");
  });

  it("exposure blocked_exposure, drawdown blocked_drawdown'dan önce gelir değil — sıralama kontrolü", () => {
    // Drawdown locked + exposure dolu → drawdown önce gelir (check #2)
    const positions: ExposurePosition[] = [makePos("BTC", "LONG", 2500)];
    const input = makePreflightInput({
      drawdownProtocol: { tier: "locked", multiplier: 0, label: "Locked" },
      openPositionsWithMargin: positions,
      equityUsd: EQUITY,
    });
    const result = runPreflightChecks(input, Date.now());
    expect(result.decision).toBe("blocked_drawdown");
  });
});

// ─────────────────────────────────────────────────────────────
// 12. Tam Senaryo: Multi-pair çapraz korelasyon
// ─────────────────────────────────────────────────────────────

describe("Tam senaryo — çok pair exposure", () => {
  it("BTC LONG $1000 + ETH LONG $800 açık → SOL LONG $600 talebi → scale_down", () => {
    const positions: ExposurePosition[] = [
      makePos("BTC", "LONG", 1000),
      makePos("ETH", "LONG", 800),
    ];
    // directionalMargin LONG = 1800 → directionalRoom = 200
    // totalMargin = 1800 → totalRoom = 700
    // request 600 → min(700, 200) = 200 < 600 → scale to 200
    const result = checkExposure(600, "LONG", EQUITY, positions);
    expect(result.verdict).toBe("scaled_down");
    expect(result.allowedMarginUsd).toBeCloseTo(200, 1);
  });

  it("BTC + ETH + SOL hepsi LONG, cap doldu → başka LONG bloke", () => {
    const positions: ExposurePosition[] = [
      makePos("BTC", "LONG", 700),
      makePos("ETH", "LONG", 700),
      makePos("BTC", "LONG", 600), // farklı BTC pozisyon (hypothetical)
    ];
    // directionalMargin LONG = 2000 → cap dolu
    const result = checkExposure(100, "LONG", EQUITY, positions);
    expect(result.verdict).toBe("blocked");
  });

  it("tek yön LONG cap dolsa bile SHORT için yer var", () => {
    const positions: ExposurePosition[] = [
      makePos("BTC", "LONG", 2000),
    ];
    // totalMargin = 2000 → totalRoom = 500
    // SHORT directionalRoom = 2000
    // min = 500 → 300 < 500 → allowed
    const result = checkExposure(300, "SHORT", EQUITY, positions);
    expect(result.verdict).toBe("allowed");
  });

  it("hedge senaryo: eşit LONG + SHORT → toplam cap, yönsel cap bağımsız", () => {
    const positions: ExposurePosition[] = [
      makePos("BTC", "LONG", 1200),
      makePos("ETH", "SHORT", 1200),
    ];
    // total = 2400 → totalRoom = 100
    // LONG directional = 1200 → room = 800
    // SHORT directional = 1200 → room = 800
    // Yeni LONG talebi 100 → min(100, 800) = 100 → allowed
    const longResult = checkExposure(100, "LONG", EQUITY, positions);
    expect(longResult.verdict).toBe("allowed");

    // Yeni SHORT talebi 100 → allowed
    const shortResult = checkExposure(100, "SHORT", EQUITY, positions);
    expect(shortResult.verdict).toBe("allowed");

    // Yeni LONG talebi 200 → totalRoom=100 → scale to 100
    const bigResult = checkExposure(200, "LONG", EQUITY, positions);
    expect(bigResult.verdict).toBe("scaled_down");
  });

  it("konfig override: agresif (totalCap=%50) daha fazla izin verir", () => {
    const positions: ExposurePosition[] = [makePos("BTC", "LONG", 3000)];
    const aggressiveConfig: ExposureConfig = {
      totalCapPct: 0.50,       // %50
      directionalCapPct: 0.40, // %40
      minMarginUsd: 5,
    };
    const result = checkExposure(1000, "LONG", EQUITY, positions, aggressiveConfig);
    // totalCap = 5000 → room = 2000; directionalCap = 4000 → room = 1000
    expect(result.verdict).toBe("allowed");
  });

  it("konfig override: muhafazakar (totalCap=%10) daha erken kısıtlar", () => {
    const positions: ExposurePosition[] = [makePos("BTC", "LONG", 800)];
    const conservativeConfig: ExposureConfig = {
      totalCapPct: 0.10,       // %10 = $1000
      directionalCapPct: 0.08, // %8 = $800
      minMarginUsd: 5,
    };
    const result = checkExposure(500, "LONG", EQUITY, positions, conservativeConfig);
    // directionalRoom = 800 - 800 = 0 → blocked
    expect(result.verdict).toBe("blocked");
  });
});
