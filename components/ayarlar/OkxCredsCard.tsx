"use client";

/**
 * OKX CREDS CARD — OKX API bağlantı durumu.
 *
 * Güvenlik notu: UI ASLA gerçek key/secret/pass gösteremez.
 * Sadece "configured / not configured" durumu okunur (/api/okx/check).
 * Gerçek creds .env.local'da tutulur — bu doğru pratik.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

interface OkxStatus {
  prodConfigured: boolean;
  demoConfigured: boolean;
}

export function OkxCredsCard(): React.ReactElement {
  const t = useT();
  const [status, setStatus] = useState<OkxStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/okx/check")
      .then(async (res) => {
        if (!res.ok) throw new Error("check failed");
        return res.json() as Promise<OkxStatus>;
      })
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("settings.okx.checkError"));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-text-t1 text-sm font-medium">
          🔐 {t("settings.okx.title")}
        </h3>
        <p className="text-text-t3 mt-1 text-xs leading-relaxed">
          {t("settings.okx.description")}
        </p>
      </div>

      {loading ? (
        <div className="text-text-t3 font-mono text-2xs tracking-wider">
          {t("settings.okx.checking")}
        </div>
      ) : error ? (
        <div className="text-signal-red font-mono text-2xs">{error}</div>
      ) : status ? (
        <div className="space-y-2">
          <StatusRow
            label={t("settings.okx.prodLabel")}
            configured={status.prodConfigured}
            t={t}
          />
          <StatusRow
            label={t("settings.okx.demoLabel")}
            configured={status.demoConfigured}
            t={t}
          />
          {!status.prodConfigured && !status.demoConfigured && (
            <div className="text-text-t3 mt-2 border-border/40 rounded border border-dashed p-2 font-mono text-2xs">
              💡 {t("settings.okx.configHint")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusRow({
  label,
  configured,
  t,
}: {
  label: string;
  configured: boolean;
  t: (k: string) => string;
}) {
  const colorClass = configured ? "text-signal-green" : "text-text-t3";
  const dotClass = configured ? "bg-signal-green" : "bg-text-t4";

  return (
    <div className="flex items-center justify-between">
      <span className="text-text-t2 font-mono text-xs tracking-wider">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        <span
          className={`font-mono text-2xs font-bold tracking-widest uppercase ${colorClass}`}
        >
          {configured
            ? t("settings.okx.configured")
            : t("settings.okx.notConfigured")}
        </span>
      </div>
    </div>
  );
}
