/**
 * OKX CLOSE POSITION — Pozisyon kapatma.
 *
 * `/api/v5/trade/close-position` (private POST, auth gerekli).
 * Market order ile tam kapatma. Pending algo orders otomatik iptal.
 */

export interface ClosePositionInput {
  instId: string;
  mgnMode: "cross" | "isolated";
  /** Hedge mode için yön — net mode'da undefined */
  posSide?: "long" | "short";
}

export interface ClosePositionResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Pozisyonu kapat (market order).
 *
 * Bilinen OKX hata kodları (UI mesajları için):
 *   - 50114, 50119: API key geçersiz
 *   - 50011: API key trade izni yok
 *   - 51000, 51008: Yetersiz bakiye / parameter
 *   - 51400: Pozisyon zaten kapatılmış
 */
export async function closePosition(
  input: ClosePositionInput,
  fetchOverride?: typeof fetch,
): Promise<ClosePositionResult> {
  const fetcher = fetchOverride ?? (globalThis.fetch as typeof fetch);
  const url = "/api/okx/api/v5/trade/close-position";

  const body: Record<string, unknown> = {
    instId: input.instId,
    mgnMode: input.mgnMode,
    autoCxl: true,
    ccy: "USDT",
  };
  if (input.posSide) {
    body.posSide = input.posSide;
  }

  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { ok: false, errorMessage: `HTTP ${res.status}` };
    }

    const raw = (await res.json()) as Record<string, unknown>;
    // OKX response: { code: "0", data: [...] }
    // Proxy yanıtı: { ok: true, data: { code, data } }
    let inner: Record<string, unknown> = raw;
    if (raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)) {
      const d = raw.data as Record<string, unknown>;
      if (typeof d.code === "string") inner = d;
    }

    const code = typeof inner.code === "string" ? inner.code : undefined;
    if (code === "0") return { ok: true };

    return {
      ok: false,
      errorCode: code,
      errorMessage: typeof inner.msg === "string" ? inner.msg : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : "Network error",
    };
  }
}

/** Hata kodu → i18n key (UI tarafı çevirir) */
export function errorCodeToKey(code: string | undefined): string {
  if (!code) return "position.closeError.unknown";
  if (code === "50114" || code === "50119") return "position.closeError.invalidKey";
  if (code === "50011") return "position.closeError.noTradePermission";
  if (code === "51000" || code === "51008") return "position.closeError.insufficientBalance";
  if (code === "51400") return "position.closeError.alreadyClosed";
  return "position.closeError.unknown";
}
