# Performance & Optimization

QUANTIX panelinin performans karakteristiği, optimization audit'i ve operatörün referans rehberi.

## Mevcut Bundle Durumu (Faz 3 #17)

| Sayfa | Size | First Load | Budget | Doluluk |
|-------|------|-----------|--------|---------|
| `/karar` | **16.4 kB** | 144 kB | 25 kB | %66 |
| `/pozisyon` | 6.9 kB | 135 kB | 15 kB | %46 |
| `/piyasa` | 5.5 kB | 133 kB | 15 kB | %37 |
| `/risk` | 5.1 kB | 133 kB | 15 kB | %34 |
| `/grafik` | 4.9 kB | 133 kB | 15 kB | %33 |
| `/pnl` | 4.8 kB | 133 kB | 15 kB | %32 |
| `/ayarlar` | 3.8 kB | 132 kB | 15 kB | %25 |
| **Shared** | — | **105 kB** | 120 kB | %88 |

**Yorum:**
- Karar sekmesi en şişman (score engine + sub-scores + UI). Bu beklenen — disiplin sahnesi.
- Shared 105/120 kB %88 doluluk — yakından izlenmeli. Yeni büyük bir kütüphane eklenirse threshold aşılabilir.
- Grafik 4.9 kB sürpriz olabilir — `lightweight-charts` (~70 kB) dinamik import sayesinde shared'a girmedi.

## Bundle Analyzer

```bash
npm run analyze
```

`ANALYZE=true` ortam değişkeniyle build koşar, tarayıcıda interaktif treemap açar. Tek tek modüllerin boyutunu görebilirsin.

## Otomatik Bütçe Kontrolü

```bash
npm run perf:check
```

`scripts/bundle-budget.ts`:
1. Production build koşar
2. Çıktıyı parse eder
3. `lib/perf/metrics.ts` thresholds'la karşılaştırır
4. İhlal varsa exit code 1 (CI'da build fail)

**Bütçe ihlali = bilinçli karar gerektirir.** Threshold yükseltmek için:
- `lib/perf/metrics.ts` `ROUTE_BUDGETS_KB`'i güncelle
- `BUG_LOG.md`'ye sebep + ölçüm yaz

## Lazy Loading Audit

Lazy yapılanlar:
- ✅ **lightweight-charts** (`/grafik`) — `dynamic(import())` + ssr:false
- ✅ **API route'lar** — `ƒ (Dynamic)` server-only
- ✅ **OG image, favicon** — public folder, JS bundle dışı

Lazy yapılabilecekler (gelecek paketler):
- Recharts veya benzeri grafik kütüphaneleri kullanılırsa
- Karar sayfasındaki score engine UI — sub-components ayrılabilir
- Telegram formatter — sadece `/api/telegram/test` çağrılınca gerekir; UI'da zaten yok ✓

## Lighthouse — Kullanıcı Bilgisayarda

Lighthouse CI sandbox'ta çalışmıyor (Chromium binary + dev server gerekir).
Kullanıcı kendi bilgisayarında:

```bash
npm run build
npm run start
# başka terminalde:
npx lighthouse http://localhost:3000/karar --view --preset=desktop
```

### Hedef metrikler

| Metrik | Hedef | Yorum |
|--------|-------|-------|
| Performance | ≥ 90 | Çoğu yerel app bu seviyede |
| Accessibility | ≥ 95 | Semantic HTML, alt tag'leri var |
| Best Practices | ≥ 95 | HTTPS gerekir (deploy sonrası) |
| SEO | ≥ 90 | Metadata + OG image hazır (paket #15) |

### LCP, CLS, INP

- **LCP (Largest Contentful Paint):** SSG sayfalar zaten hızlı, < 1.5s hedef
- **CLS (Cumulative Layout Shift):** Skeleton state'leri var (paket #2'de eklendi) — hydration sırasında shift olmaz
- **INP (Interaction to Next Paint):** Zustand store'lar lightweight, store update'leri < 50ms

## React Strict Mode

`next.config.ts`'de `reactStrictMode: true` aktif. Bu, development'ta:
- useEffect double-mount kontrolü
- Side effect'lerin idempotent olduğunu doğrular
- Production'da etkisi yok

## Server Component Optimization

Şu an çoğu sayfa `"use client"` ile başlıyor — Zustand store + useEffect ihtiyacı.
Optimization fırsatları (gelecek):
- Layout component'leri server-side render edilebilir
- Static içerik (footer, header'ın markı bölümü) server component
- İnteraktif kısımlar islanding pattern

Karar verilmedi: bu refactor karmaşıklığı gerektirir, mevcut performans yeterli.

## CDN ve Asset Optimization

Mevcut:
- IBM Plex Sans/Mono — Google Fonts CDN üzerinden (panel v55.51 ile uyum)
- SVG asset'ler — public folder, otomatik HTTP cache

Deploy edildiğinde (paket #18):
- Vercel/Netlify otomatik edge cache yapar
- SVG'ler Content-Type doğru servis edilir
- Brotli/Gzip otomatik

## Performance Regresyon Koruması

Her PR'da:
```bash
npm run type-check      # TS hata yok
npm test                # Unit + integration testler yeşil
npm run perf:check      # Bundle bütçesi aşılmadı
npm run e2e             # E2E senaryoları yeşil
```

CI'da bu 4 komut zincirleme koşmalı. İlk üç başarısızsa merge engellenmeli.
