"use client";

/**
 * LOCKS LIST — Aktif lock'ları gösterir.
 *
 * Her lock için ayrı card: tip + sebep + countdown.
 * Boş durumda "No active locks" rozeti.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useRiskStore } from "@/lib/store/riskStore";
import { useAccountStore } from "@/lib/store/accountStore";
import {
  computeActiveLocks,
  formatLockDuration,
  type ActiveLock,
} from "@/lib/risk/locks";

const KIND_LABEL_KEYS = {
  btc_cooldown: "risk.locks.btcCooldown",
  btc_self_cooldown: "risk.locks.btcSelfCooldown",
  account_locked: "risk.locks.accountLocked",
  lock_ramp: "risk.locks.lockRamp",
} as const;

export function LocksList(): React.ReactElement {
  const t = useT();
  const btcCooldownUntil = useRiskStore((s) => s.btcCooldownUntil);
  const btcCooldownReason = useRiskStore((s) => s.btcCooldownReason);
  const btcSelfCooldownUntil = useRiskStore((s) => s.btcSelfCooldownUntil);
  const lockReleasedAt = useRiskStore((s) => s.lockReleasedAt);
  const drawdownProtocol = useAccountStore((s) => s.drawdownProtocol);

  // Saniyede bir tick — countdown'lar canlı görünsün
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  // BTC ve ETH için locks ayrı hesap — UI'da hepsini birleştir
  const btcLocks = computeActiveLocks(
    {
      btcCooldownUntil,
      btcCooldownReason,
      btcSelfCooldownUntil,
      lockReleasedAt,
      drawdownProtocol,
    },
    now,
    "BTC",
  );
  const ethLocks = computeActiveLocks(
    {
      btcCooldownUntil,
      btcCooldownReason,
      btcSelfCooldownUntil,
      lockReleasedAt,
      drawdownProtocol,
    },
    now,
    "ETH",
  );
  // Dedupe (account_locked / lock_ramp tekrar etmesin)
  const seen = new Set<string>();
  const allLocks: ActiveLock[] = [];
  for (const l of [...btcLocks, ...ethLocks]) {
    const key = `${l.kind}_${l.reason ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      allLocks.push(l);
    }
  }

  return (
    <div className="border-border bg-bg-card rounded-lg border p-4">
      <h3 className="text-text-t1 mb-3 font-mono text-xs tracking-widest">
        {t("risk.locks.title")}
      </h3>
      {allLocks.length === 0 ? (
        <div className="bg-soft-green text-signal-green inline-flex items-center gap-1.5 rounded-md border border-signal-green/40 px-2 py-1 font-mono text-xs tracking-wider">
          <span>✓</span>
          <span>{t("risk.locks.noActive")}</span>
        </div>
      ) : (
        <div className="space-y-2">
          {allLocks.map((lock, i) => {
            const labelKey = KIND_LABEL_KEYS[lock.kind];
            const isHard =
              lock.kind === "account_locked" ||
              lock.kind === "btc_cooldown" ||
              lock.kind === "btc_self_cooldown";
            const cls = isHard
              ? "bg-soft-red text-signal-red border-signal-red/40"
              : "bg-soft-amber text-signal-amber border-signal-amber/40";
            return (
              <div
                key={`${lock.kind}-${i}`}
                className={`rounded-md border px-3 py-2 ${cls}`}
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="shrink-0 font-mono text-xs font-bold tracking-wider">
                    {t(labelKey)}
                  </span>
                  {lock.remainingSec !== undefined && (
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {formatLockDuration(lock.remainingSec)}
                    </span>
                  )}
                </div>
                {lock.reason && (
                  <div className="text-text-t2 mt-1 overflow-hidden text-ellipsis text-2xs leading-relaxed">
                    {lock.reason}
                  </div>
                )}
                {lock.kind === "lock_ramp" && (
                  <div className="text-text-t3 mt-1 text-2xs leading-relaxed">
                    {t("risk.locks.lockRampDescription")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
