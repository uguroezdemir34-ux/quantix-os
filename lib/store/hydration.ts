/**
 * STORE — Hydration helper (Next.js SSR/CSR mismatch fix).
 *
 * SORUN:
 *   Next.js server'da localStorage yok. İlk render hep "varsayılan" değer
 *   ile yapılır. Client'ta hydrate olunca localStorage'tan gerçek değer
 *   gelir → React "Hydration mismatch" hatası verir.
 *
 * ÇÖZÜM:
 *   `useHydrated()` ilk client render'a kadar `false` döner. UI bu hook'u
 *   kullanarak persistent state'i göstermeyi geciktirir, sadece client'ta
 *   render eder.
 *
 * KULLANIM:
 *   const hydrated = useHydrated();
 *   const lastTab = useSettingsStore(s => s.lastTab);
 *   if (!hydrated) return <Skeleton />;  // veya default render
 *   return <Tab name={lastTab} />;
 */

"use client";

import { useEffect, useState } from "react";

/**
 * Component client'ta hydrate olduğunda true döner.
 *
 * @returns false → server-side veya ilk client render
 * @returns true → useEffect çalıştı, client'tayız, localStorage erişilebilir
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
