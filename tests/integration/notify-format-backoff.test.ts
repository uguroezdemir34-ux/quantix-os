/**
 * NOTIFY / FORMAT / BACKOFF TESTS
 *
 * escapeMarkdownV2: özel karakterler escape, boş string, düz metin
 * escapeNumber: nokta ve eksi escape
 * formatUsdMd2: "$" prefix, escape
 * formatPctMd2: işaret + escape
 * bold / italic / code: sarma
 * formatNotifyMessage: trade_opened, trade_closed, sl_hit, tp_hit, lock_triggered, test
 *
 * i18n/format:
 *   formatPrice: sign/nosign, locale, negatif
 *   formatCoinAmount: pair suffix, 4 decimal
 *   formatPercent: sign, locale, negatif
 *   formatTime: döndürülen string type kontrolü
 *
 * ws/backoff:
 *   getReconnectDelay: retryCount ≤ 0, ≤ FAST, exponential, max cap
 */

import { describe, it, expect } from "vitest";
import {
  escapeMarkdownV2,
  escapeNumber,
  formatUsdMd2,
  formatPctMd2,
  bold,
  italic,
  code,
} from "@/lib/notify/telegram/escape";
import { formatNotifyMessage } from "@/lib/notify/telegram/formatter";
import type { NotifyMessage } from "@/lib/notify/types";
import {
  formatPrice,
  formatCoinAmount,
  formatPercent,
  formatTime,
} from "@/lib/i18n/format";
import { getReconnectDelay } from "@/lib/ws/backoff";

// ─────────────────────────────────────────────────────────────
// escapeMarkdownV2
// ─────────────────────────────────────────────────────────────

describe("escapeMarkdownV2()", () => {
  it("boş string → ''", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });

  it("düz metin → değişmez", () => {
    expect(escapeMarkdownV2("BTC")).toBe("BTC");
  });

  it("nokta escape edilir", () => {
    expect(escapeMarkdownV2("0.5")).toBe("0\\.5");
  });

  it("eksi escape edilir", () => {
    expect(escapeMarkdownV2("-10")).toBe("\\-10");
  });

  it("artı escape edilir", () => {
    expect(escapeMarkdownV2("+5")).toBe("\\+5");
  });

  it("ünlem escape edilir", () => {
    expect(escapeMarkdownV2("Go!")).toBe("Go\\!");
  });

  it("birden fazla özel karakter", () => {
    const r = escapeMarkdownV2("(BTC) +1.5%");
    expect(r).toBe("\\(BTC\\) \\+1\\.5%");
  });

  it("tüm 18 özel karakteri escape eder", () => {
    const specials = "_*[]()~`>#+-=|{}.!";
    const result = escapeMarkdownV2(specials);
    // her biri \x formatında
    expect(result.startsWith("\\")).toBe(true);
    expect(result.split("\\").length - 1).toBe(specials.length);
  });

  it("yıldız escape edilir", () => {
    expect(escapeMarkdownV2("*bold*")).toBe("\\*bold\\*");
  });
});

// ─────────────────────────────────────────────────────────────
// escapeNumber
// ─────────────────────────────────────────────────────────────

describe("escapeNumber()", () => {
  it("tamsayı — değişmez", () => {
    expect(escapeNumber(42)).toBe("42");
  });

  it("ondalıklı — nokta escape", () => {
    expect(escapeNumber(60123.45)).toBe("60123\\.45");
  });

  it("negatif — eksi ve nokta escape", () => {
    expect(escapeNumber(-0.5)).toBe("\\-0\\.5");
  });
});

// ─────────────────────────────────────────────────────────────
// formatUsdMd2
// ─────────────────────────────────────────────────────────────

describe("formatUsdMd2()", () => {
  it("$ prefix ile başlar", () => {
    expect(formatUsdMd2(100)).toMatch(/^\$/);
  });

  it("nokta escape edilmiş", () => {
    const r = formatUsdMd2(100.5);
    expect(r).toContain("\\.");
  });

  it("negatif tutar da çalışır", () => {
    const r = formatUsdMd2(-50);
    expect(r).toMatch(/^\$/);
  });

  it("custom decimals=0 tam sayı", () => {
    const r = formatUsdMd2(1000, 0);
    expect(r).toBe("$1,000");
  });
});

// ─────────────────────────────────────────────────────────────
// formatPctMd2
// ─────────────────────────────────────────────────────────────

describe("formatPctMd2()", () => {
  it("pozitif → +işareti", () => {
    const r = formatPctMd2(0.0125);
    expect(r).toContain("\\+");
  });

  it("negatif → -işareti escape", () => {
    const r = formatPctMd2(-0.005);
    expect(r).toContain("\\-");
  });

  it("% karakteri dahil", () => {
    const r = formatPctMd2(0.01);
    expect(r).toContain("%");
  });

  it("sıfır → + işareti", () => {
    const r = formatPctMd2(0);
    expect(r).toContain("\\+");
  });
});

// ─────────────────────────────────────────────────────────────
// bold / italic / code
// ─────────────────────────────────────────────────────────────

describe("bold()", () => {
  it("* ile sarar", () => {
    expect(bold("BTC")).toBe("*BTC*");
  });

  it("içeriği escape eder", () => {
    expect(bold("2.0%")).toBe("*2\\.0%*");
  });
});

describe("italic()", () => {
  it("_ ile sarar", () => {
    expect(italic("note")).toBe("_note_");
  });
});

describe("code()", () => {
  it("backtick ile sarar", () => {
    expect(code("GET /api")).toBe("`GET /api`");
  });

  it("içindeki backtick escape edilir", () => {
    expect(code("a`b")).toBe("`a\\`b`");
  });
});

// ─────────────────────────────────────────────────────────────
// formatNotifyMessage
// ─────────────────────────────────────────────────────────────

describe("formatNotifyMessage() — trade_opened", () => {
  const base: NotifyMessage = {
    kind: "trade_opened",
    pair: "BTC",
    direction: "LONG",
    entry: 50000,
    stopPrice: 49000,
    tp1: 51000,
    tp2: 52000,
    score: 82,
    reasonText: "Strong breakout",
    timestamp: 1_700_000_000_000,
  };

  it("QUANTIX başlığı içerir", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("QUANTIX");
  });

  it("pair adı geçer", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("BTC");
  });

  it("LONG yönü belirtilmiş", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("LONG");
  });

  it("stop fiyatı geçer", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("Stop");
  });

  it("TP1 geçer", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("TP1");
  });

  it("TP2 geçer", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("TP2");
  });

  it("skor geçer", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("82");
  });

  it("hashtag satırı", () => {
    const r = formatNotifyMessage(base);
    expect(r).toContain("#BTC");
  });

  it("SHORT yönü", () => {
    const msg = { ...base, direction: "SHORT" as const };
    const r = formatNotifyMessage(msg);
    expect(r).toContain("SHORT");
  });
});

describe("formatNotifyMessage() — trade_closed", () => {
  it("kapanış başlığı", () => {
    const r = formatNotifyMessage({
      kind: "trade_closed",
      pair: "ETH",
      direction: "LONG",
      pnl: 150.5,
      pnlPct: 0.03,
    });
    expect(r).toContain("POZİSYON KAPANDI");
    expect(r).toContain("ETH");
    expect(r).toContain("150");
  });
});

describe("formatNotifyMessage() — sl_hit", () => {
  it("SL başlığı", () => {
    const r = formatNotifyMessage({
      kind: "sl_hit",
      pair: "BTC",
      pnl: -100,
    });
    expect(r).toContain("STOP-LOSS");
    expect(r).toContain("100");
  });
});

describe("formatNotifyMessage() — tp_hit", () => {
  it("TP başlığı", () => {
    const r = formatNotifyMessage({
      kind: "tp_hit",
      pair: "BTC",
      pnl: 200,
    });
    expect(r).toContain("TAKE-PROFIT");
  });
});

describe("formatNotifyMessage() — lock_triggered", () => {
  it("lock başlığı", () => {
    const r = formatNotifyMessage({
      kind: "lock_triggered",
      pair: "BTC",
      reasonText: "Günlük kayıp limiti aşıldı",
    });
    expect(r).toContain("DİSİPLİN KİLİDİ");
    expect(r).toContain("limit");
  });
});

describe("formatNotifyMessage() — test", () => {
  it("test mesajı", () => {
    const r = formatNotifyMessage({ kind: "test", pair: "BTC" });
    expect(r).toContain("QUANTIX");
    expect(r).toContain("Test");
  });
});

// ─────────────────────────────────────────────────────────────
// i18n/format — formatPrice
// ─────────────────────────────────────────────────────────────

describe("formatPrice()", () => {
  it("pozitif, işaretsiz, en locale", () => {
    const r = formatPrice(50000, "en");
    expect(r).toMatch(/^\$50,000\.00$/);
  });

  it("negatif değer → − prefix", () => {
    const r = formatPrice(-100, "en");
    expect(r).toContain("−");
    expect(r).toContain("100");
  });

  it("showSign=true, pozitif → + prefix", () => {
    const r = formatPrice(100, "en", true);
    expect(r).toContain("+");
  });

  it("showSign=true, negatif → − prefix", () => {
    const r = formatPrice(-100, "en", true);
    expect(r).toContain("−");
  });

  it("tr locale döndürür string", () => {
    const r = formatPrice(1000, "tr");
    expect(typeof r).toBe("string");
    expect(r).toContain("$");
  });
});

describe("formatCoinAmount()", () => {
  it("pair suffix", () => {
    const r = formatCoinAmount(0.5, "BTC", "en");
    expect(r).toContain("BTC");
  });

  it("4 decimal", () => {
    const r = formatCoinAmount(1, "ETH", "en");
    expect(r).toContain("1.0000");
  });
});

describe("formatPercent()", () => {
  it("pozitif, işaretsiz", () => {
    const r = formatPercent(5.5, "en");
    expect(r).toMatch(/5\.50%/);
    expect(r).not.toContain("+");
    expect(r).not.toContain("−");
  });

  it("negatif → − prefix", () => {
    const r = formatPercent(-2.5, "en");
    expect(r).toContain("−");
  });

  it("showSign=true, pozitif → +", () => {
    const r = formatPercent(1, "en", true);
    expect(r).toContain("+");
  });
});

describe("formatTime()", () => {
  it("string döner", () => {
    const r = formatTime(1_700_000_000_000, "en");
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("tr locale string döner", () => {
    const r = formatTime(1_700_000_000_000, "tr");
    expect(typeof r).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────
// ws/backoff — getReconnectDelay
// ─────────────────────────────────────────────────────────────

describe("getReconnectDelay()", () => {
  it("retryCount=0 → 2000ms (fast)", () => {
    expect(getReconnectDelay(0)).toBe(2000);
  });

  it("retryCount=1 → 2000ms", () => {
    expect(getReconnectDelay(1)).toBe(2000);
  });

  it("retryCount=4 → 2000ms (son fast retry)", () => {
    expect(getReconnectDelay(4)).toBe(2000);
  });

  it("retryCount=5 → 3000ms (base exponential)", () => {
    expect(getReconnectDelay(5)).toBe(3000);
  });

  it("retryCount=6 → 4500ms (3000*1.5^1)", () => {
    expect(getReconnectDelay(6)).toBe(4500);
  });

  it("retryCount=7 → 6750ms (3000*1.5^2)", () => {
    expect(getReconnectDelay(7)).toBe(6750);
  });

  it("yüksek retryCount → max 30000ms", () => {
    expect(getReconnectDelay(50)).toBe(30000);
  });

  it("negatif retryCount → 2000ms (fast fallback)", () => {
    expect(getReconnectDelay(-5)).toBe(2000);
  });

  it("gecikme monoton artar (5→20 arası)", () => {
    const delays = [5, 6, 7, 8, 9, 10].map(getReconnectDelay);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });

  it("max cap aşılmaz", () => {
    for (let i = 5; i <= 30; i++) {
      expect(getReconnectDelay(i)).toBeLessThanOrEqual(30000);
    }
  });
});
