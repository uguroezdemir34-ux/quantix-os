"use client";

/**
 * TELEGRAM TEST CARD — VIP kanala test mesajı gönder.
 *
 * Kullanıcı bu butona basınca /api/telegram/test tetiklenir.
 * Sonuç: success / "not configured" / network error.
 */

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

type TestStatus = "idle" | "loading" | "success" | "not_configured" | "error";

export function TelegramTestCard(): React.ReactElement {
  const t = useT();
  const [status, setStatus] = useState<TestStatus>("idle");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  async function handleTest() {
    setStatus("loading");
    setErrorDetail(null);
    try {
      const res = await fetch("/api/telegram/test");
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
        messageId?: string;
      };

      if (data.ok) {
        setStatus("success");
      } else if (data.error === "not_configured") {
        setStatus("not_configured");
      } else {
        setStatus("error");
        setErrorDetail(data.error ?? data.message ?? null);
      }
    } catch (e) {
      setStatus("error");
      setErrorDetail(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-text-t1 text-sm font-medium">
          💬 {t("settings.telegram.title")}
        </h3>
        <p className="text-text-t3 mt-1 text-xs leading-relaxed">
          {t("settings.telegram.description")}
        </p>
      </div>

      <button
        type="button"
        onClick={handleTest}
        disabled={status === "loading"}
        className="border-border hover:bg-bg-page disabled:opacity-50 rounded border px-3 py-1.5 font-mono text-2xs tracking-widest uppercase transition-colors"
      >
        {status === "loading"
          ? t("settings.telegram.testing")
          : t("settings.telegram.testButton")}
      </button>

      {status === "success" && (
        <div className="text-signal-green mt-3 font-mono text-2xs tracking-wider">
          ✓ {t("settings.telegram.success")}
        </div>
      )}

      {status === "not_configured" && (
        <div className="text-signal-amber mt-3 font-mono text-2xs leading-relaxed">
          ⚠ {t("settings.telegram.notConfigured")}
        </div>
      )}

      {status === "error" && (
        <div className="text-signal-red mt-3 font-mono text-2xs leading-relaxed">
          ✗ {t("settings.telegram.sendError")}
          {errorDetail && (
            <div className="text-text-t4 mt-1 text-2xs">{errorDetail}</div>
          )}
        </div>
      )}
    </div>
  );
}
