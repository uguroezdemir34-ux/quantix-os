/**
 * KADEMELİ TRAILING STOP TESTS
 *
 * ATR çarpanı ratchet (2.0→1.5→1.0→0.75), stop tek yönlü hareket,
 * çıkış sinyali, idempotent çıkış, SHORT davranışı,
 * snapshot serialize/deserialize.
 */

import { describe, it, expect } from "vitest";
import { KademeliTrailingStop } from "@/lib/trailing/kademeli";
import type { TrailSnapshot } from "@/lib/trailing/kademeli";

// ─────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────

describe("KademeliTrailingStop — constructor", () => {
  it("starts with no stop, no exit", () => {
    const ts = new KademeliTrailingStop("LONG");
    expect(ts.aktif_stop).toBeNull();
    expect(ts.cikis_tetiklendi).toBe(false);
    expect(ts.en_iyi_fiyat).toBeNull();
    expect(ts.son_atr_carpan).toBe(2.0);
  });

  it("invalid direction throws", () => {
    expect(() => new KademeliTrailingStop("FLAT" as any)).toThrow();
  });

  it("case-insensitive direction normalised", () => {
    const ts = new KademeliTrailingStop("long" as any);
    expect(ts.yon).toBe("LONG");
  });
});

// ─────────────────────────────────────────────────────────────
// ATR çarpanı ratchet
// ─────────────────────────────────────────────────────────────

describe("ATR çarpanı ratchet (LONG)", () => {
  const GIRIS = 50_000;
  const ATR = 1_000;

  it("< 2% peak → 2.0× (başlangıç)", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, GIRIS, ATR, GIRIS);
    expect(ts.son_atr_carpan).toBe(2.0);
  });

  it("2% peak → 1.5×", () => {
    const ts = new KademeliTrailingStop("LONG");
    // price up 2% = +1000
    ts.guncelle(GIRIS, GIRIS * 1.02, ATR, GIRIS * 1.02);
    expect(ts.son_atr_carpan).toBe(1.5);
  });

  it("5% peak → 1.0×", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, GIRIS * 1.05, ATR, GIRIS * 1.05);
    expect(ts.son_atr_carpan).toBe(1.0);
  });

  it("10% peak → 0.75×", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, GIRIS * 1.10, ATR, GIRIS * 1.10);
    expect(ts.son_atr_carpan).toBe(0.75);
  });

  it("ratchet: does NOT revert when price pulls back", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, GIRIS * 1.05, ATR, GIRIS * 1.05); // 5% → 1.0×
    ts.guncelle(GIRIS, GIRIS * 1.01, ATR, GIRIS * 1.01); // pullback to 1%
    // peak stays 5%, so multiplier stays 1.0×
    expect(ts.son_atr_carpan).toBe(1.0);
    expect(ts.en_yuksek_kar_yuzde).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────
// Stop tek yönlü hareket
// ─────────────────────────────────────────────────────────────

describe("Stop tek yönlü (LONG)", () => {
  const GIRIS = 50_000;
  const ATR = 1_000;

  it("stop follows price up", () => {
    const ts = new KademeliTrailingStop("LONG");
    const r1 = ts.guncelle(GIRIS, 50_000, ATR, 50_000);
    const r2 = ts.guncelle(GIRIS, 52_000, ATR, 52_000);
    expect(r2.stop_fiyat!).toBeGreaterThan(r1.stop_fiyat!);
  });

  it("stop does NOT drop when price falls", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, 55_000, ATR, 55_000);
    const stopAtPeak = ts.aktif_stop!;
    ts.guncelle(GIRIS, 51_000, ATR, 51_000); // pullback
    expect(ts.aktif_stop).toBe(stopAtPeak); // unchanged
  });

  it("stop = en_iyi_fiyat - atr_carpan × ATR", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, 51_000, ATR, 51_000);
    const expectedStop = 51_000 - ts.son_atr_carpan * ATR;
    expect(ts.aktif_stop).toBeCloseTo(expectedStop);
  });
});

// ─────────────────────────────────────────────────────────────
// Çıkış sinyali
// ─────────────────────────────────────────────────────────────

describe("Çıkış sinyali (LONG)", () => {
  const GIRIS = 50_000;
  const ATR = 1_000;

  it("close above stop → no exit", () => {
    const ts = new KademeliTrailingStop("LONG");
    const r = ts.guncelle(GIRIS, 52_000, ATR, 52_000);
    // stop = 52000 - 2*1000 = 50000; close=52000 > 50000 → no exit
    expect(r.cikis_sinyali).toBe(false);
  });

  it("close below stop → exit triggered", () => {
    const ts = new KademeliTrailingStop("LONG");
    // Establish stop first
    ts.guncelle(GIRIS, 55_000, ATR, 54_000); // peak=55k, stop≈53k, close=54k (above)
    const stopLevel = ts.aktif_stop!;
    // Now close below stop
    const r = ts.guncelle(GIRIS, stopLevel - 100, ATR, stopLevel - 100);
    expect(r.cikis_sinyali).toBe(true);
    expect(ts.cikis_tetiklendi).toBe(true);
  });

  it("idempotent after exit", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(GIRIS, 55_000, ATR, 54_000);
    const stopLevel = ts.aktif_stop!;
    ts.guncelle(GIRIS, stopLevel - 100, ATR, stopLevel - 100); // triggers exit
    const stopAfterExit = ts.aktif_stop;

    // Subsequent calls return same state
    const r2 = ts.guncelle(GIRIS, 60_000, ATR, 60_000);
    expect(r2.cikis_sinyali).toBe(true);
    expect(ts.aktif_stop).toBe(stopAfterExit); // stop doesn't change
    expect(ts.en_iyi_fiyat).not.toBe(60_000); // peak doesn't update
  });

  it("wick below stop does NOT trigger exit (close-only rule)", () => {
    const ts = new KademeliTrailingStop("LONG");
    // Establish stop around 48000
    ts.guncelle(GIRIS, 50_000, ATR, 50_000);
    const stopLevel = ts.aktif_stop!;
    // current=50k (wick low would be stopLevel-100), but close=50k > stop
    const r = ts.guncelle(GIRIS, 50_000, ATR, stopLevel + 100);
    expect(r.cikis_sinyali).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// SHORT davranışı
// ─────────────────────────────────────────────────────────────

describe("SHORT trailing stop", () => {
  const GIRIS = 50_000;
  const ATR = 1_000;

  it("stop follows price DOWN (one-directional)", () => {
    const ts = new KademeliTrailingStop("SHORT");
    const r1 = ts.guncelle(GIRIS, 50_000, ATR, 50_000);
    const r2 = ts.guncelle(GIRIS, 48_000, ATR, 48_000);
    expect(r2.stop_fiyat!).toBeLessThan(r1.stop_fiyat!);
  });

  it("stop does NOT rise when price bounces", () => {
    const ts = new KademeliTrailingStop("SHORT");
    ts.guncelle(GIRIS, 45_000, ATR, 45_000);
    const stopAtPeak = ts.aktif_stop!;
    ts.guncelle(GIRIS, 49_000, ATR, 49_000); // bounce
    expect(ts.aktif_stop).toBe(stopAtPeak);
  });

  it("SHORT exit when close >= stop", () => {
    const ts = new KademeliTrailingStop("SHORT");
    ts.guncelle(GIRIS, 45_000, ATR, 46_000); // peak=45k, stop=47k, close=46k (below stop)
    const stopLevel = ts.aktif_stop!;
    // Close ABOVE stop triggers exit for SHORT
    const r = ts.guncelle(GIRIS, stopLevel + 100, ATR, stopLevel + 100);
    expect(r.cikis_sinyali).toBe(true);
  });

  it("SHORT stop = en_iyi_fiyat + atr_carpan × ATR", () => {
    const ts = new KademeliTrailingStop("SHORT");
    ts.guncelle(GIRIS, 48_000, ATR, 48_000);
    const expectedStop = 48_000 + ts.son_atr_carpan * ATR;
    expect(ts.aktif_stop).toBeCloseTo(expectedStop);
  });

  it("SHORT peak kâr: price below entry increases profit", () => {
    const ts = new KademeliTrailingStop("SHORT");
    ts.guncelle(GIRIS, GIRIS * 0.95, ATR, GIRIS * 0.95); // 5% profit
    expect(ts.son_atr_carpan).toBe(1.0); // 5% → 1.0×
  });
});

// ─────────────────────────────────────────────────────────────
// durum() helper
// ─────────────────────────────────────────────────────────────

describe("durum()", () => {
  it("returns correct shape after update", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(50_000, 51_000, 1_000, 51_000);
    const d = ts.durum();
    expect(d.yon).toBe("LONG");
    expect(d.en_iyi_fiyat).toBe(51_000);
    expect(d.aktif_stop).not.toBeNull();
    expect(d.cikis).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Snapshot serialize / deserialize
// ─────────────────────────────────────────────────────────────

describe("toSnapshot() / fromSnapshot()", () => {
  it("round-trip preserves all fields", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(50_000, 53_000, 1_000, 53_000);

    const snap = ts.toSnapshot();
    expect(snap.yon).toBe("LONG");
    expect(snap.en_iyi_fiyat).toBe(53_000);
    expect(snap.aktif_stop).not.toBeNull();
    expect(snap.cikis_tetiklendi).toBe(false);

    const restored = KademeliTrailingStop.fromSnapshot(snap);
    expect(restored.yon).toBe("LONG");
    expect(restored.en_iyi_fiyat).toBe(ts.en_iyi_fiyat);
    expect(restored.aktif_stop).toBe(ts.aktif_stop);
    expect(restored.en_yuksek_kar_yuzde).toBe(ts.en_yuksek_kar_yuzde);
    expect(restored.cikis_tetiklendi).toBe(false);
  });

  it("restores exited state correctly", () => {
    const ts = new KademeliTrailingStop("LONG");
    ts.guncelle(50_000, 55_000, 1_000, 54_000);
    const stopLevel = ts.aktif_stop!;
    ts.guncelle(50_000, stopLevel - 100, 1_000, stopLevel - 100);
    expect(ts.cikis_tetiklendi).toBe(true);

    const snap = ts.toSnapshot();
    const restored = KademeliTrailingStop.fromSnapshot(snap);
    expect(restored.cikis_tetiklendi).toBe(true);

    // Restored instance is also idempotent
    const r = restored.guncelle(50_000, 60_000, 1_000, 60_000);
    expect(r.cikis_sinyali).toBe(true);
  });

  it("snapshot with null/missing fields uses defaults", () => {
    const snap: TrailSnapshot = {
      yon: "SHORT",
      en_iyi_fiyat: null,
      en_yuksek_kar_yuzde: 0,
      aktif_stop: null,
      cikis_tetiklendi: false,
      son_atr_carpan: 2.0,
    };
    const ts = KademeliTrailingStop.fromSnapshot(snap);
    expect(ts.yon).toBe("SHORT");
    expect(ts.en_iyi_fiyat).toBeNull();
    expect(ts.son_atr_carpan).toBe(2.0);
  });
});
