import { redirect } from "next/navigation";

/**
 * Root sayfa — varsayılan tab'e yönlendirme.
 *
 * Panel'de "lastTab" localStorage'tan okunup gösteriliyordu. Server-side
 * render'da localStorage erişimi yok; bu yüzden basit yaklaşım:
 *   - Her zaman /karar'a redirect
 *   - Client'ta lastTab varsa, settingsStore.rehydrate sonrası BottomNav
 *     zaten o sayfayı highlight ediyor — kullanıcı manuel olarak değiştirebilir.
 *
 * Alternatif (Faz 2 sonraki paket): cookie ile server-side lastTab okuma.
 * Şimdilik basit tutuyoruz.
 */
export default function HomePage() {
  redirect("/karar");
}
