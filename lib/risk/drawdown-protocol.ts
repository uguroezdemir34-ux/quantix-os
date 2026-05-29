/**
 * DRAWDOWN PROTOCOL — v55.51 ile birebir.
 * Kaynak: panel_v55_51.html satır 4684-4723.
 *
 * v55.38 ile binary kilit (locked/normal) graduated 4-tier sisteme geçti:
 *   Normal      pnlPct > -1.5    risk ×1.0   skor 80+
 *   Caution     pnlPct ≤ -1.5    risk ×0.5   skor 80+
 *   Restricted  pnlPct ≤ -2.5    risk ×0.25  skor 85+
 *   Locked      pnlPct ≤ -3.0    risk ×0     skor 100 (effectively impossible)
 *
 * Saf fonksiyon — yan etki yok, sadece input pnlPct'ten objeyi türetir.
 */

export type DrawdownTier = "normal" | "caution" | "restricted" | "locked";

export interface DrawdownProtocol {
  tier: DrawdownTier;
  /** Sizer'a uygulanacak risk çarpanı (0..1) */
  multiplier: number;
  /** Trade için gereken minimum skor */
  minScore: number;
  /** UI'da gösterilen etiket (renk emoji + isim) */
  label: string;
  /** Tier sebebi — kullanıcıya gösterilir, log'lara yazılır */
  reason: string;
}

export function getDrawdownProtocol(pnlPct: number): DrawdownProtocol {
  // Defansif: bakiye yüklenmemişse normal varsay (panel satır 4685-4688)
  if (!Number.isFinite(pnlPct)) {
    return {
      tier: "normal",
      multiplier: 1.0,
      minScore: 80,
      label: "🟢 Normal",
      reason: "Veri yok",
    };
  }

  if (pnlPct <= -3.0) {
    return {
      tier: "locked",
      multiplier: 0,
      minScore: 100,
      label: "🔒 Tam kilit",
      reason: `Günlük kayıp %${pnlPct.toFixed(2)} — tam kilit aktif`,
    };
  }

  if (pnlPct <= -2.5) {
    return {
      tier: "restricted",
      multiplier: 0.25,
      minScore: 85,
      label: "🟠 Kısıtlı",
      reason: `Günlük kayıp %${pnlPct.toFixed(2)} — risk ¼, sadece skor 85+`,
    };
  }

  if (pnlPct <= -1.5) {
    return {
      tier: "caution",
      multiplier: 0.5,
      minScore: 80,
      label: "🟡 Dikkat",
      reason: `Günlük kayıp %${pnlPct.toFixed(2)} — risk ½, eşik standart`,
    };
  }

  return {
    tier: "normal",
    multiplier: 1.0,
    minScore: 80,
    label: "🟢 Normal",
    reason: "Drawdown sınırları içinde",
  };
}
