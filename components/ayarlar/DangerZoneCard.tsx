"use client";

/**
 * DANGER ZONE CARD — Tüm verileri sıfırla.
 *
 * settingsStore + tradesStore reset. Kullanıcıdan onay alınır.
 * Geri alınamaz işlem — ikinci confirm gerektirir.
 */

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useTradesStore } from "@/lib/store/tradesStore";

export function DangerZoneCard(): React.ReactElement {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  const resetSettings = useSettingsStore((s) => s.reset);
  const resetTrades = useTradesStore((s) => s._reset);

  function handleReset() {
    resetSettings();
    resetTrades();
    setConfirming(false);
    // Sayfayı yenile — store'lar temizlendi
    if (typeof window !== "undefined") window.location.reload();
  }

  return (
    <div className="border-signal-red/30 bg-soft-red rounded-lg border p-4">
      <h3 className="text-signal-red mb-2 font-mono text-xs font-medium tracking-widest">
        ⚠ {t("settings.dangerZone")}
      </h3>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="border-signal-red/50 text-signal-red hover:bg-signal-red/10 rounded border px-3 py-1.5 font-mono text-xs font-bold tracking-wider transition-colors"
        >
          {t("settings.resetAll")}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-signal-red font-mono text-xs">
            {t("settings.resetConfirm")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="border-signal-red bg-signal-red/20 text-signal-red rounded border px-3 py-1.5 font-mono text-xs font-bold tracking-wider"
            >
              {t("settings.resetAll")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border-border text-text-t3 rounded border px-3 py-1.5 font-mono text-xs"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
