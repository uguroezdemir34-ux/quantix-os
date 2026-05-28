"use client";

/**
 * PLACEHOLDER TAB — Henüz inşa edilmemiş sekmeler için.
 * Sonraki paketlerde her sekme gerçek içeriğiyle değişecek.
 *
 * Title ve description hala caller'dan geliyor (caller component i18n yapacak),
 * ama "YAPIM AŞAMASINDA" rozetini içeride çeviriyoruz.
 */

import { useT } from "@/lib/i18n/context";

export function PlaceholderTab({
  title,
  icon,
  description,
}: {
  title: string;
  icon: string;
  description: string;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="mb-4 text-5xl opacity-50" aria-hidden>
        {icon}
      </span>
      <h2 className="font-mono text-base tracking-widest text-text-t1">
        {title.toUpperCase()}
      </h2>
      <p className="text-text-t2 mt-2 max-w-xs text-sm leading-relaxed">
        {description}
      </p>
      <div className="border-border bg-bg-card text-text-t3 mt-6 rounded-md border px-3 py-1.5 font-mono text-2xs tracking-wider">
        {t("placeholder.inProgress")} · FAZ 2
      </div>
    </div>
  );
}
