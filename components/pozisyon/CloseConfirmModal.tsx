"use client";

/**
 * CLOSE CONFIRM MODAL — Pozisyon kapatma onayı.
 *
 * Trade Confirm Modal'a benzer yapı: backdrop click, Esc, role=dialog.
 */

import { useEffect } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { formatCoinAmount } from "@/lib/i18n/format";
import type { Position } from "@/lib/okx/positions";

export function CloseConfirmModal({
  position,
  onConfirm,
  onClose,
}: {
  position: Position;
  onConfirm: () => void;
  onClose: () => void;
}): React.ReactElement {
  const t = useT();
  const locale = useLocale();
  const isLong = position.direction === "LONG";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const dirLabel = t(isLong ? "direction.long" : "direction.short");
  const sizeStr = formatCoinAmount(position.size, position.pair, locale);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-confirm-title"
      onClick={onClose}
    >
      <div
        className="border-border bg-bg-card w-full max-w-md rounded-lg border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="close-confirm-title"
          className="text-text-t1 mb-3 font-mono text-sm tracking-widest"
        >
          ⚠ {t("position.closeConfirmTitle")}
        </h2>

        <p className="text-text-t2 mb-5 text-sm leading-relaxed">
          {t("position.closeConfirmText", {
            pair: position.pair,
            direction: dirLabel,
            size: `${sizeStr} ${position.pair}`,
          })}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border-border text-text-t2 hover:bg-bg flex-1 rounded-md border py-2 font-mono text-sm tracking-wider transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="bg-signal-red text-bg flex-1 rounded-md py-2 font-mono text-sm font-bold tracking-wider transition-colors hover:opacity-90"
          >
            ✕ {t("position.closeButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
