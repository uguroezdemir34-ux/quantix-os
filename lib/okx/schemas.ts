/**
 * OKX V5 YANIT ŞEMALARI — Zod ile runtime doğrulama.
 *
 * Panel sessizce `data.code === '0'` kontrolüyle başarı sayıyor ama
 * dönen objenin yapısını doğrulamıyor (`data.data` boş array, eksik alan,
 * tip mismatch — hepsi sessizce geçiyor).
 *
 * v2'de tüm OKX yanıtları Zod ile doğrulanır → bozuk yanıt → açıkça hata.
 * Bu, "sessiz fail" senaryolarını öldürür.
 */

import { z } from "zod";

// ───────────── OKX V5 zarf formatı ─────────────
// Tüm OKX yanıtları { code, msg, data } şeklinde gelir.
// code '0' başarı, diğer her şey hata.

export const OkxEnvelopeSchema = z.object({
  code: z.string(),
  msg: z.string().optional().default(""),
  data: z.array(z.unknown()).optional().default([]),
});

export type OkxEnvelope = z.infer<typeof OkxEnvelopeSchema>;

// ───────────── Hesap bakiye (panel: fetchBalance) ─────────────

export const OkxBalanceDetailSchema = z.object({
  ccy: z.string(),
  eq: z.string().optional(),
  availEq: z.string().optional(),
  cashBal: z.string().optional(),
});

export const OkxBalanceSchema = z.object({
  totalEq: z.string().optional(),
  details: z.array(OkxBalanceDetailSchema).optional().default([]),
});

// ───────────── Pozisyon (panel: fetchPositions) ─────────────

export const OkxPositionSchema = z.object({
  instId: z.string(),
  posSide: z.enum(["long", "short", "net"]),
  pos: z.string(),
  avgPx: z.string(),
  markPx: z.string().optional(),
  last: z.string().optional(),
  mgnMode: z.enum(["cross", "isolated"]).optional(),
  // Diğer alanlar opsiyonel ve passthrough — gelecekteki OKX eklemeleri bozmasın
}).passthrough();

// ───────────── Algo order (cancel-algos için) ─────────────

export const OkxAlgoOrderSchema = z.object({
  algoId: z.string(),
  instId: z.string(),
  ordType: z.string().optional(),
}).passthrough();

// ───────────── Kline (mum) ─────────────
// OKX raw kline array: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
// String olarak gelir, parse etmek client tarafının görevi.

export const OkxKlineRawSchema = z.array(z.string()).min(6);
export const OkxKlinesRawSchema = z.array(OkxKlineRawSchema);

// ───────────── Order sonucu (place/close) ─────────────

export const OkxOrderResultSchema = z.object({
  sCode: z.string(), // '0' başarı
  sMsg: z.string().optional().default(""),
  ordId: z.string().optional(),
  clOrdId: z.string().optional(),
}).passthrough();

// ───────────── Yardımcı: zarfın başarılı mı bozuk mu olduğunu test et ─────────────

/**
 * OKX zarfını parse et + başarı/hata ayrımı yap.
 * Panel `data.code === '0'` ile yaptığı işin Zod'lu hali, +
 * POST için iç içe `data[0].sCode` durumunu da ele alır (satır 4145).
 */
export interface ParsedOkxResponse<T = unknown> {
  ok: boolean;
  data?: T;
  err?: string;
  code?: string;
}

export function parseOkxEnvelope<T = unknown>(raw: unknown): ParsedOkxResponse<T> {
  const env = OkxEnvelopeSchema.safeParse(raw);
  if (!env.success) {
    return { ok: false, err: "MALFORMED_ENVELOPE" };
  }
  const { code, msg, data } = env.data;

  // Panel davranışı: data[0].sCode '0' değilse hata (POST order vs)
  if (code === "0") {
    const first = data[0] as { sCode?: string; sMsg?: string } | undefined;
    if (first && typeof first === "object" && "sCode" in first && first.sCode !== "0") {
      return {
        ok: false,
        err: first.sMsg || `CODE_${first.sCode}`,
        code: first.sCode,
      };
    }
    return { ok: true, data: data as T };
  }
  return {
    ok: false,
    err: msg || `CODE_${code}`,
    code,
  };
}
