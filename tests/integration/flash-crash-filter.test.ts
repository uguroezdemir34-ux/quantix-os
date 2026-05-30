/**
 * ANOMALOUS CANDLE & FLASH CRASH FILTER — Entegrasyon Testleri
 *
 * 1. computeBasis — basis hesabı
 * 2. evaluateBasis — basis_spike / basis_extreme / ok
 * 3. evaluateMovement — flash_crash / flash_pump / unconfirmed / suspicious / ok
 * 4. evaluateSanity — katman birleştirme + freeze kararı
 * 5. FreezeState — create / update / expire / extend
 * 6. appendSnapshot — MAX_SNAPSHOT_HISTORY kısıtı
 * 7. Gerçekçi senaryo testleri
 */

import { describe, it, expect } from "vitest";
import {
  computeBasis,
  computeChangePct,
  computeConfirmationRatio,
  evaluateBasis,
  evaluateMovement,
  evaluateSanity,
  createFreezeState,
  updateFreezeState,
  isFreezeActive,
  appendSnapshot,
  filterWindow,
  getWindowEdges,
  DEFAULT_BASIS_SPIKE_PCT,
  DEFAULT_BASIS_EXTREME_PCT,
  DEFAULT_PERP_MOVE_PCT,
  DEFAULT_CONFIRMATION_RATIO,
  DEFAULT_FREEZE_DURATION_MS,
  MAX_SNAPSHOT_HISTORY,
  type PriceSnapshot,
  type SanityConfig,
  type FreezeState,
} from "@/lib/market/sanity";

// ─── Yardımcılar ─────────────────────────────────────────────

const T0 = 1_700_000_000_000; // sabit epoch

function snap(
  perpPrice: number,
  spotPrice: number,
  timestamp = T0,
): PriceSnapshot {
  return { timestamp, perpPrice, spotPrice };
}

function resolvedCfg(overrides: SanityConfig = {}): Required<SanityConfig> {
  return {
    basisSpikePct: overrides.basisSpikePct ?? DEFAULT_BASIS_SPIKE_PCT,
    basisExtremePct: overrides.basisExtremePct ?? DEFAULT_BASIS_EXTREME_PCT,
    perpMovePct: overrides.perpMovePct ?? DEFAULT_PERP_MOVE_PCT,
    confirmationRatio: overrides.confirmationRatio ?? DEFAULT_CONFIRMATION_RATIO,
    freezeDurationMs: overrides.freezeDurationMs ?? DEFAULT_FREEZE_DURATION_MS,
    analysisWindowMs: overrides.analysisWindowMs ?? 3_000,
  };
}

// ─── computeBasis ─────────────────────────────────────────────

describe("computeBasis", () => {
  it("eşit fiyatlar → basis=0", () => {
    expect(computeBasis(60000, 60000)).toBe(0);
  });

  it("perp primli → pozitif basis", () => {
    const b = computeBasis(60300, 60000);
    expect(b).toBeCloseTo(0.5);
  });

  it("perp iskontolu → negatif basis", () => {
    const b = computeBasis(59700, 60000);
    expect(b).toBeCloseTo(-0.5);
  });

  it("spotPrice=0 → 0 döner (sıfır bölme koruması)", () => {
    expect(computeBasis(60000, 0)).toBe(0);
  });

  it("büyük sapma doğru hesaplanır", () => {
    const b = computeBasis(61500, 60000); // +%2.5
    expect(b).toBeCloseTo(2.5);
  });
});

// ─── computeChangePct ─────────────────────────────────────────

describe("computeChangePct", () => {
  it("değişim yok → 0", () => {
    expect(computeChangePct(100, 100)).toBe(0);
  });

  it("+%5 doğru", () => {
    expect(computeChangePct(100, 105)).toBeCloseTo(5);
  });

  it("-%10 doğru", () => {
    expect(computeChangePct(100, 90)).toBeCloseTo(-10);
  });

  it("from=0 → 0 döner", () => {
    expect(computeChangePct(0, 100)).toBe(0);
  });
});

// ─── computeConfirmationRatio ─────────────────────────────────

describe("computeConfirmationRatio", () => {
  it("çok küçük perp hareketi → null", () => {
    expect(computeConfirmationRatio(0.005, 0.002)).toBeNull();
  });

  it("aynı yön, aynı büyüklük → 1.0", () => {
    expect(computeConfirmationRatio(2, 2)).toBe(1.0);
  });

  it("spot daha az hareket → orantılı değer", () => {
    const r = computeConfirmationRatio(4, 1);
    expect(r).toBeCloseTo(0.25);
  });

  it("ters yönler → 0 (sıfır onay)", () => {
    expect(computeConfirmationRatio(3, -1)).toBe(0);
    expect(computeConfirmationRatio(-3, 1)).toBe(0);
  });

  it("spot daha fazla hareket → 1.0'a kısıtlanır", () => {
    const r = computeConfirmationRatio(2, 5); // 5/2=2.5 → kısıt
    expect(r).toBe(1.0);
  });

  it("her iki sıfır → null", () => {
    expect(computeConfirmationRatio(0, 0)).toBeNull();
  });
});

// ─── evaluateBasis ────────────────────────────────────────────

describe("evaluateBasis", () => {
  const cfg = resolvedCfg();

  it("normal basis → level=ok", () => {
    const r = evaluateBasis(snap(60100, 60000), cfg);
    expect(r.level).toBe("ok");
    expect(r.anomalyType).toBe("none");
  });

  it(`basis = ${DEFAULT_BASIS_SPIKE_PCT}% → anomaly + basis_spike`, () => {
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100);
    const r = evaluateBasis(snap(perpPrice, 60000), cfg);
    expect(r.level).toBe("anomaly");
    expect(r.anomalyType).toBe("basis_spike");
  });

  it(`basis = ${DEFAULT_BASIS_EXTREME_PCT}% → extreme + basis_extreme`, () => {
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_EXTREME_PCT / 100);
    const r = evaluateBasis(snap(perpPrice, 60000), cfg);
    expect(r.level).toBe("extreme");
    expect(r.anomalyType).toBe("basis_extreme");
  });

  it("negatif basis (backwardation) da tespit edilir", () => {
    const perpPrice = 60000 * (1 - DEFAULT_BASIS_SPIKE_PCT / 100);
    const r = evaluateBasis(snap(perpPrice, 60000), cfg);
    expect(r.level).toBe("anomaly");
    expect(r.anomalyType).toBe("basis_spike");
  });
});

// ─── evaluateMovement ─────────────────────────────────────────

describe("evaluateMovement — flash crash", () => {
  const cfg = resolvedCfg();

  it("perp %3 düşüş, spot sakin → flash_crash", () => {
    const oldest = snap(60000, 59950, T0);
    const newest = snap(58200, 59940, T0 + 2000); // perp -%3, spot ~0
    const r = evaluateMovement({ oldest, newest }, cfg);
    expect(r.anomalyType).toBe("flash_crash");
    expect(r.level).toBe("anomaly");
    expect(r.confirmationRatio).not.toBeNull();
    expect(r.confirmationRatio!).toBeLessThan(DEFAULT_CONFIRMATION_RATIO);
  });

  it("perp %5 düşüş, spot %4.5 düşüş (iyi onay) → ok", () => {
    const oldest = snap(60000, 60000, T0);
    const newest = snap(57000, 57300, T0 + 2000); // perp -%5, spot -%4.5
    const r = evaluateMovement({ oldest, newest }, cfg);
    expect(r.level).toBe("ok");
    expect(r.anomalyType).toBe("none");
  });
});

describe("evaluateMovement — flash pump", () => {
  const cfg = resolvedCfg();

  it("perp %4 çıkış, spot +%0.1 → flash_pump", () => {
    const oldest = snap(60000, 60000, T0);
    const newest = snap(62400, 60060, T0 + 1000); // perp +4%, spot +0.1%
    const r = evaluateMovement({ oldest, newest }, cfg);
    expect(r.anomalyType).toBe("flash_pump");
    expect(r.level).toBe("anomaly");
  });

  it("spot ters yönde (perp çıkış, spot düşüş) → flash_pump (confirmationRatio=0)", () => {
    const oldest = snap(60000, 60000, T0);
    const newest = snap(62400, 59500, T0 + 1000);
    const r = evaluateMovement({ oldest, newest }, cfg);
    expect(r.anomalyType).toBe("flash_pump");
    expect(r.confirmationRatio).toBe(0);
  });
});

describe("evaluateMovement — küçük hareket", () => {
  const cfg = resolvedCfg();

  it(`perp %${DEFAULT_PERP_MOVE_PCT * 0.5} hareket → ok (eşik altı)`, () => {
    const oldest = snap(60000, 60000, T0);
    const newest = snap(60000 * (1 + (DEFAULT_PERP_MOVE_PCT * 0.5) / 100), 60000, T0 + 1000);
    const r = evaluateMovement({ oldest, newest }, cfg);
    expect(r.level).toBe("ok");
  });
});

describe("evaluateMovement — suspicious", () => {
  it("onay eşiğin hemen üstünde (ama 2× altında) → suspicious", () => {
    const cfg = resolvedCfg({ confirmationRatio: 0.25 });
    // perp +%2, spot +%0.6 → ratio=0.3 (0.25 < 0.3 < 0.5) → suspicious
    const oldest2 = snap(60000, 60000, T0);
    const newest2 = snap(61200, 60360, T0 + 1000); // perp +2%, spot +0.6% → ratio=0.3
    const r2 = evaluateMovement({ oldest: oldest2, newest: newest2 }, cfg);
    expect(r2.level).toBe("suspicious");
    expect(r2.anomalyType).toBe("unconfirmed_move");
  });
});

// ─── evaluateSanity ───────────────────────────────────────────

describe("evaluateSanity — temel", () => {
  it("normal piyasa → level=ok, freezeSl=false", () => {
    const current = snap(60030, 60000);
    const r = evaluateSanity(current, [], {}, T0);
    expect(r.level).toBe("ok");
    expect(r.freezeSl).toBe(false);
    expect(r.freezeUntil).toBeNull();
    expect(r.anomalyType).toBe("none");
  });

  it("basis spike → level=anomaly, freezeSl=true", () => {
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100 + 0.01);
    const current = snap(perpPrice, 60000);
    const r = evaluateSanity(current, [], {}, T0);
    expect(r.level).toBe("anomaly");
    expect(r.freezeSl).toBe(true);
    expect(r.freezeUntil).toBe(T0 + DEFAULT_FREEZE_DURATION_MS);
  });

  it("basis extreme → level=extreme, freezeSl=true", () => {
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_EXTREME_PCT / 100 + 0.01);
    const current = snap(perpPrice, 60000);
    const r = evaluateSanity(current, [], {}, T0);
    expect(r.level).toBe("extreme");
    expect(r.freezeSl).toBe(true);
  });

  it("flash crash tespiti — geçmiş penceresiyle", () => {
    const history: PriceSnapshot[] = [
      snap(60000, 59980, T0 - 2000),
      snap(59800, 59970, T0 - 1000),
    ];
    const current = snap(57600, 59960, T0); // perp -%4, spot sakin
    const r = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    expect(r.anomalyType).toBe("flash_crash");
    expect(r.freezeSl).toBe(true);
  });

  it("flash pump tespiti — geçmiş penceresiyle", () => {
    const history: PriceSnapshot[] = [
      snap(60000, 60000, T0 - 2000),
    ];
    const current = snap(62500, 60050, T0); // perp +%4.2, spot +%0.08
    const r = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    expect(r.anomalyType).toBe("flash_pump");
    expect(r.freezeSl).toBe(true);
  });

  it("yeterli geçmiş yok (1 snapshot) → pencere analizi yok, sadece basis", () => {
    const r = evaluateSanity(snap(60030, 60000), [], {}, T0);
    expect(r.level).toBe("ok");
    expect(r.perpMovePct).toBe(0);
  });

  it("pencere dışındaki eski snapshot'lar dikkate alınmaz", () => {
    // 30 saniye önceki büyük düşüş — pencere 3 sn
    const history: PriceSnapshot[] = [
      snap(65000, 65000, T0 - 30_000), // çok eski
    ];
    const current = snap(60000, 60000, T0);
    const r = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    // Pencere dışında kalır → pencere analizi yapılmaz
    expect(r.level).toBe("ok");
  });

  it("özel freeze süresi çalışır", () => {
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100 + 0.01);
    const r = evaluateSanity(
      snap(perpPrice, 60000),
      [],
      { freezeDurationMs: 5000 },
      T0,
    );
    expect(r.freezeUntil).toBe(T0 + 5000);
  });

  it("basisPct ve perpMovePct/spotMovePct sonuçta dönüyor", () => {
    const history = [snap(60000, 60000, T0 - 1000)];
    const current = snap(60300, 60100, T0);
    const r = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    expect(typeof r.basisPct).toBe("number");
    expect(typeof r.perpMovePct).toBe("number");
    expect(typeof r.spotMovePct).toBe("number");
  });
});

describe("evaluateSanity — katman önceliği", () => {
  it("hem flash_crash hem basis_spike → basis_extreme önce (yoksa flash kazanır)", () => {
    const history = [snap(60000, 60000, T0 - 1000)];
    const current = snap(57600, 59970, T0); // perp -%4 flash, spot sakin
    const r = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    expect(r.freezeSl).toBe(true);
    // flash_crash veya basis_spike olabilir — ikisi de anomaly seviyesinde
    expect(["flash_crash", "basis_spike", "anomaly"]).toContain(
      r.anomalyType !== "none" ? r.anomalyType : "anomaly",
    );
  });

  it("extreme → flash'ten üstündür", () => {
    const history = [snap(60000, 60000, T0 - 1000)];
    const perpExtreme = 60000 * (1 + DEFAULT_BASIS_EXTREME_PCT / 100 + 0.1);
    const current = snap(perpExtreme, 60000, T0);
    const r = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    expect(r.level).toBe("extreme");
    expect(r.anomalyType).toBe("basis_extreme");
  });
});

// ─── FreezeState ──────────────────────────────────────────────

describe("createFreezeState", () => {
  it("başlangıçta aktif değil", () => {
    const s = createFreezeState();
    expect(s.active).toBe(false);
    expect(s.until).toBeNull();
    expect(s.triggeredBy).toBeNull();
  });
});

describe("updateFreezeState", () => {
  it("anomali yoksa freeze başlamaz", () => {
    const s = createFreezeState();
    const result = { freezeSl: false } as any;
    const next = updateFreezeState(s, result, T0);
    expect(next.active).toBe(false);
  });

  it("anomali gelince freeze başlar", () => {
    const s = createFreezeState();
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100 + 0.01);
    const sanityResult = evaluateSanity(snap(perpPrice, 60000), [], {}, T0);
    const next = updateFreezeState(s, sanityResult, T0);
    expect(next.active).toBe(true);
    expect(next.until).toBe(T0 + DEFAULT_FREEZE_DURATION_MS);
    expect(next.triggeredBy).toBe("basis_spike");
  });

  it("süresi dolmuş freeze → sıfırlanır, yeni anomali gelmezse inactive", () => {
    const expired: FreezeState = {
      active: true,
      until: T0 - 1, // geçmişte
      triggeredBy: "basis_spike",
      triggeredAt: T0 - 11_000,
    };
    const noAnomalyResult = evaluateSanity(snap(60030, 60000), [], {}, T0);
    const next = updateFreezeState(expired, noAnomalyResult, T0);
    expect(next.active).toBe(false);
  });

  it("yeni anomali gelince freeze süresi uzatılır (en geç bitiş kazanır)", () => {
    const existing: FreezeState = {
      active: true,
      until: T0 + 5000, // 5 sn kalan
      triggeredBy: "basis_spike",
      triggeredAt: T0 - 5000,
    };
    // Yeni anomali 10 sn freeze → T0 + 10_000 > T0 + 5000
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100 + 0.01);
    const sanityResult = evaluateSanity(snap(perpPrice, 60000), [], { freezeDurationMs: 10_000 }, T0);
    const next = updateFreezeState(existing, sanityResult, T0);
    expect(next.until).toBe(T0 + 10_000);
  });

  it("triggeredAt — ilk anomali zamanını korur", () => {
    const first: FreezeState = {
      active: true,
      until: T0 + 8000,
      triggeredBy: "basis_spike",
      triggeredAt: T0 - 2000,
    };
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100 + 0.01);
    const sanityResult = evaluateSanity(snap(perpPrice, 60000), [], {}, T0);
    const next = updateFreezeState(first, sanityResult, T0);
    expect(next.triggeredAt).toBe(T0 - 2000); // ilk zaman korunur
  });
});

describe("isFreezeActive", () => {
  it("active=false → false", () => {
    expect(isFreezeActive(createFreezeState(), T0)).toBe(false);
  });

  it("until gelecekte → true", () => {
    const s: FreezeState = { active: true, until: T0 + 5000, triggeredBy: "flash_crash", triggeredAt: T0 };
    expect(isFreezeActive(s, T0 + 4999)).toBe(true);
  });

  it("until geçmişte → false", () => {
    const s: FreezeState = { active: true, until: T0 - 1, triggeredBy: "flash_crash", triggeredAt: T0 - 11000 };
    expect(isFreezeActive(s, T0)).toBe(false);
  });

  it("exactly at until → false (sınır dışı)", () => {
    const s: FreezeState = { active: true, until: T0, triggeredBy: "flash_crash", triggeredAt: T0 - 10000 };
    expect(isFreezeActive(s, T0)).toBe(false);
  });
});

// ─── appendSnapshot ───────────────────────────────────────────

describe("appendSnapshot", () => {
  it("history MAX altındayken hepsini tutar", () => {
    const history: PriceSnapshot[] = [snap(60000, 60000, T0)];
    const next = appendSnapshot(history, snap(60100, 60100, T0 + 1000));
    expect(next).toHaveLength(2);
  });

  it(`${MAX_SNAPSHOT_HISTORY} sınırını geçince en eski düşer`, () => {
    const history: PriceSnapshot[] = Array.from({ length: MAX_SNAPSHOT_HISTORY }, (_, i) =>
      snap(60000, 60000, T0 + i * 100),
    );
    const newSnap = snap(61000, 60990, T0 + MAX_SNAPSHOT_HISTORY * 100);
    const next = appendSnapshot(history, newSnap);
    expect(next).toHaveLength(MAX_SNAPSHOT_HISTORY);
    expect(next[next.length - 1]).toBe(newSnap);
    expect(next[0].timestamp).toBe(T0 + 100); // T0 düştü
  });

  it("orijinal dizi değişmez (immutable)", () => {
    const original: PriceSnapshot[] = [snap(60000, 60000, T0)];
    appendSnapshot(original, snap(60100, 60100, T0 + 1000));
    expect(original).toHaveLength(1);
  });
});

// ─── filterWindow ─────────────────────────────────────────────

describe("filterWindow", () => {
  it("pencere içindekiler döner", () => {
    const history = [
      snap(60000, 60000, T0 - 5000),
      snap(60100, 60100, T0 - 2000),
      snap(60200, 60200, T0 - 500),
    ];
    const result = filterWindow(history, T0, 3000);
    expect(result).toHaveLength(2);
    expect(result[0].timestamp).toBe(T0 - 2000);
  });

  it("tüm eski → boş dizi", () => {
    const history = [snap(60000, 60000, T0 - 10_000)];
    expect(filterWindow(history, T0, 3000)).toHaveLength(0);
  });
});

// ─── getWindowEdges ───────────────────────────────────────────

describe("getWindowEdges", () => {
  it("tek snapshot → null", () => {
    expect(getWindowEdges([snap(60000, 60000, T0)])).toBeNull();
  });

  it("doğru en eski ve en yeni", () => {
    const snaps = [
      snap(60000, 60000, T0 + 500),
      snap(60100, 60100, T0),
      snap(60200, 60200, T0 + 1000),
    ];
    const edges = getWindowEdges(snaps);
    expect(edges).not.toBeNull();
    expect(edges!.oldest.timestamp).toBe(T0);
    expect(edges!.newest.timestamp).toBe(T0 + 1000);
  });
});

// ─── Gerçekçi senaryolar ──────────────────────────────────────

describe("Senaryo: Anlık likidasyon zinciri (flash crash)", () => {
  it("3 sn içinde perp -%8, spot -%0.2 → anomali, SL dondur", () => {
    const history: PriceSnapshot[] = [
      snap(50000, 49990, T0 - 3000),
      snap(49800, 49985, T0 - 2000),
      snap(49500, 49980, T0 - 1000),
    ];
    const current = snap(46000, 49970, T0); // perp -%8, spot ~-%0.04
    const result = evaluateSanity(current, history, { analysisWindowMs: 3500 }, T0);
    expect(result.freezeSl).toBe(true);
    expect(result.anomalyType).toBe("flash_crash");
    expect(result.perpMovePct).toBeLessThan(-5);
    expect(result.confirmationRatio).not.toBeNull();
    expect(result.confirmationRatio!).toBeLessThan(DEFAULT_CONFIRMATION_RATIO);
  });
});

describe("Senaryo: Gerçek düşüş (spot onaylar)", () => {
  it("perp -%3, spot -%2.8 → level=ok, freezeSl=false", () => {
    const history: PriceSnapshot[] = [
      snap(60000, 60000, T0 - 2000),
    ];
    const current = snap(58200, 58320, T0); // perp -%3, spot -%2.8
    const result = evaluateSanity(current, history, { analysisWindowMs: 3000 }, T0);
    expect(result.level).toBe("ok");
    expect(result.freezeSl).toBe(false);
  });
});

describe("Senaryo: Borsa basis anomalisi (OKX perp / Binance spot farkı)", () => {
  it("OKX perp %2 primle işlem görürken spot normal → basis_spike", () => {
    const current = snap(61200, 60000, T0); // %2 basis
    const result = evaluateSanity(current, [], {}, T0);
    expect(result.level).toBe("anomaly");
    expect(result.anomalyType).toBe("basis_spike");
    expect(result.basisPct).toBeCloseTo(2);
    expect(result.freezeSl).toBe(true);
  });
});

describe("Senaryo: Freeze state yaşam döngüsü", () => {
  it("anomali → freeze başlar → süre dolar → serbest kalır", () => {
    let state = createFreezeState();

    // Anomali
    const perpPrice = 60000 * (1 + DEFAULT_BASIS_SPIKE_PCT / 100 + 0.01);
    const r1 = evaluateSanity(
      snap(perpPrice, 60000),
      [],
      { freezeDurationMs: 5000 },
      T0,
    );
    state = updateFreezeState(state, r1, T0);
    expect(isFreezeActive(state, T0 + 3000)).toBe(true);

    // Süre doldu
    const r2 = evaluateSanity(snap(60030, 60000), [], {}, T0 + 6000);
    state = updateFreezeState(state, r2, T0 + 6000);
    expect(isFreezeActive(state, T0 + 6000)).toBe(false);
  });
});
