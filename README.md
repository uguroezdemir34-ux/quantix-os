# Uğur Trader Panel v2

v55.51 (`panel_v55_51.html`, 11343 satır, 500KB) browser tabanlı panelin
Next.js + TypeScript mimarisine taşınmış hali.

## Mimari Özet

- **Framework:** Next.js 15 (App Router)
- **Dil:** TypeScript (strict mode — `any` yasak)
- **UI:** React 19 + Tailwind 3 (v55.51 paletinden birebir port: turuncu marka kimliği, IBM Plex Sans/Mono)
- **State:** Zustand (mevcut `ST` global + 25 ayrı `ug52_*` localStorage anahtarı persist edilecek)
- **Data:** TanStack Query (3 dk tarama döngüsü + MTF cache mantığı buraya taşınacak)
- **Validation:** Zod (OKX yanıtlarını runtime'da doğrular)
- **Test:** Vitest + **panel parity testleri** (eski JS ↔ yeni TS birebir uyum)
- **Deploy:** Vercel (GitHub Pages'in yerine)

OKX API secret artık **browser'a inmez**. Sadece `app/api/*` server route'larında okunur.
Demo mode (`x-simulated-trading: 1`) v55.51'de eklendi — yeni mimaride aynen korunacak.

## Kurulum (Windows için — sıfırdan)

### 1. Node.js kur

[nodejs.org](https://nodejs.org) — LTS sürümü (20+).

```powershell
node --version    # v20.x veya üstü olmalı
npm --version
```

### 2. Git CLI kur

[git-scm.com](https://git-scm.com/download/win) — varsayılan ayarlarla.

```powershell
git --version
```

### 3. GitHub bağlantısı

```powershell
git config --global user.name "Uğur Özdemir"
git config --global user.email "github_e_mail_adresin@..."
```

### 4. Projeyi başlat

```powershell
cd C:\Users\X\Desktop\trade-panel-v2
npm install
```

`node_modules/` oluşacak (~400 MB).

### 5. Environment dosyası

```powershell
copy .env.example .env.local
notepad .env.local
```

OKX prod + demo key'leri, Telegram token doldur.
`.env.local` commit edilmez (`.gitignore` koruyor).

### 6. Geliştirme sunucusu

```powershell
npm run dev
```

[http://localhost:3000](http://localhost:3000) — turuncu accent + IBM Plex font + "Faz 0 başarıyla tamamlandı".

### 7. Testler

```powershell
npm test              # tüm testler
npm run test:parity   # sadece eski-yeni uyum testleri (KRİTİK)
```

**Parity testleri 100% geçmeli.** Bir tane bile sapma = port hatalı = durup düzelt.

### 8. GitHub push

```powershell
git init
git add .
git commit -m "feat: faz 0 — next.js iskeleti, rsi portu, parity test"
git remote add origin https://github.com/uguroezdemir34-ux/trade-panel-v2.git
git branch -M main
git push -u origin main
```

PAT (Personal Access Token) gerekiyor: GitHub → Settings → Developer settings → PAT classic → `repo` scope.

### 9. Vercel

[vercel.com](https://vercel.com) → GitHub ile bağlan → `trade-panel-v2` import et → `.env.local` içeriğini Environment Variables'a yapıştır → Deploy.

Her `git push` otomatik deploy ediyor.

## Klasör Yapısı

```
trade-panel-v2/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # IBM Plex font yüklemesi
│   ├── page.tsx            # Faz 0 doğrulama sayfası
│   └── globals.css
├── lib/
│   ├── constants/
│   │   └── pairs.ts        # ✓ PAIRS = ['BTC', 'ETH'], InstId tipleri
│   ├── indicators/
│   │   └── rsi.ts          # ✓ Faz 1, modül #1
│   │   # SIRADAKI: ema.ts, bb.ts, atr.ts, atr-percentile.ts, vwap.ts, adx.ts
│   ├── okx/                # (faz 1) — REST + WebSocket + demo header
│   ├── signal-engine/      # (faz 1) — computeScoreForPair, pullback engine
│   ├── risk/               # (faz 1) — drawdown protocol, daily lock, guardian
│   ├── regime/             # (faz 1) — displayRegime MTF (1W/1D/4H)
│   ├── trailing/           # (faz 1) — KademeliTrailingStop sınıfı
│   ├── forward-test/       # (faz 1) — logForwardTest, evaluate, stats
│   └── macro/              # (faz 1) — F&G, BTC dominance, btcMacro
├── types/
│   └── candle.ts           # ✓ OHLCV ({ o, h, l, c, v }) panel ile birebir
├── tests/
│   ├── indicators/
│   │   └── rsi.test.ts     # ✓ Birim testleri
│   └── parity/
│       └── rsi-parity.test.ts  # ✓ v55.51 ↔ v2 birebir uyum (Faz 3 prova)
├── .env.example
├── package.json
├── tsconfig.json           # strict mode
├── tailwind.config.ts      # v55.51 renk paleti
├── next.config.ts
└── vitest.config.ts
```

## v55.51'den Taşınacak Modüller (envanter)

Toplam ~90 üst seviye fonksiyon, 8 kategori:

| Kategori | Faz 1 hedefi | Notlar |
|----------|--------------|--------|
| İndikatörler | RSI ✓, EMA, BB, ATR, ATRPercentile, ADX, VWAP, volumeRatio | BB **population variance** kullanıyor, ATR **basit SMA of TR** — Wilder değil |
| SR (Support/Resistance) | findSwing*, getPrev*, getRoundNumber, detectSRLevels | Skor motoruna ~23/100 puan katkı |
| OKX REST | okxFetch, okxPost, hmacSHA256 | Server-side route'lara taşınacak |
| OKX WebSocket | initWS, reconnect logic | Hala browser'da kalabilir (public data) |
| Pozisyon yönetimi | fetchBalance, fetchPositions, mergeAlgoOrders | OKX algo + position merge mantığı |
| Sinyal motoru | computeScoreForPair (~880 satır), pullback engine, hard blocks | En büyük modül |
| Risk/Disiplin | getDrawdownProtocol (4 tier), checkDailyLossLock, lockReleaseRamp | |
| Trailing | KademeliTrailingStop sınıfı (ATR çarpan ratchet) | Ralli modu |
| Forward Test | log, evaluate, stats, modal | v55.30: ÖLÇÜM modu — Telegram'a sinyal göndermez |
| Display Regime | computeDisplayRegime (3 TF: 1W/1D/4H), hysteresis | v55.45-MTF, UI-only |
| Macro | fetchFG, fetchBtcDom, fetchBtcMacroData (1D/1W cache) | v55.46 cache: 1D 15dk, 1W 60dk |
| Telegram | buildTelegramSignalMsg, sendTelegram | Python bot ayrı kalıyor, sadece HTTP köprü |

## localStorage Anahtarları (25 adet, persist edilecek)

```
ug52_okx          ug52_okx_demo     ug52_demo_mode
ug52_tg           ug52_trades       ug52_v
ug52_lastTab      ug52_disc_log     ug52_disc_last_day
ug52_last_day     ug52_eventskip    ug52_ftMode
ug52_fwdtest      ug52_btccd        ug52_lockReleased
ug52_trade_cutoff ug52_trails_prod  ug52_trails_demo
ug52_trails_*     ug52_week_shown   ug52_ws_url
ug52_bal_<date>   ug52_lock_<...>   ug52_sigs_<date>
ug52_start_<date>
```

**Trail key mode izolasyonu (v55.51):**
- `ug52_trails_prod` → gerçek hesap trail'leri
- `ug52_trails_demo` → demo hesap trail'leri
- Eski `ug52_trails` → ilk yüklemede otomatik `ug52_trails_prod`'a migrate edilir

Yeni mimari → tek Zustand store, persist middleware ile aynı anahtarlara map'lenecek (geriye dönük uyum: migration script Faz 4'te).

## Faz Durumu

| Faz | Durum | Açıklama |
|-----|-------|----------|
| 0 — Hazırlık | ✓ | Next.js iskeleti, TS strict, Tailwind v55.51 paleti |
| 1a — İndikatör portu | ✓ | RSI, EMA, BB, ATR, ATR%, VWAP, Vol, ADX |
| 1b paket #1 — Trailing sınıfı | ✓ | KademeliTrailingStop + 200 senaryo parity |
| 1b paket #2 — Trailing entegrasyon | ✓ | persistence, manager, mode-change race koruma |
| 1b paket #3 — OKX HTTP katmanı | ✓ | Server-side proxy, secret browser'a inmedi |
| 1b paket #4 — Risk & Disiplin | ✓ | Drawdown, daily lock, BTC cooldown, discipline log |
| 1b paket #5a — Swing & S/R Detection | ✓ | Pivots, PDH/PDL/PWH/PWL, round, strength, modifier |
| 1b paket #5b — Liquidity Sweep | ✓ | YENİ özellik — Wyckoff/ICT pattern, +5/10/15 skor bonus |
| **1b paket #5c — Bucket Stats + Wilson CI + EV** | ✓ | Port + 2 YENİ: Wilson CI (istatistiksel cut), Expectancy (R-bazlı) |
| 1b paket #5d-i — Skor Hesaplayıcılar | ✓ | 10 saf fonksiyon: direction + 8 kategori + 2 bonus, 124 birim test |
| 1b paket #5d-ii — Hard/Soft Block Kuralları | ✓ | 19 saf fonksiyon: 13 hard + 6 soft block, 85 birim test |
| **1b paket #5d-iii — Score Orchestrator** | ✓ | 12 katmanlı pipeline + 31 entegrasyon testi |
| **1b paket #5e — Pullback Engine** | ✓ | 8 şartlı trend continuation dedektörü, threshold 72 |
| **1b paket #7 — Macro & Regime** | ✓ | F&G + BTC dominance + market summary; server proxy + 30dk cache |
| **Faz 1b — KAPANDI** | ✓ | 682 backend test, panel ile bit-by-bit uyum |
| **Faz 2 #1 — Store iskeleti** | ✓ | persist (SSR-safe localStorage) + settingsStore + Zod validate |
| **Faz 2 #2 — UI Shell + 7 Sekme** | ✓ | AppShell + Header + BottomNav + 7 sayfa + gerçek Ayarlar |
| **Faz 2 #3 — OKX WebSocket Client** | ✓ | Real-time price stream, marketStore, reconnect, silence watchdog |
| **Faz 2 #4 — Karar Sekmesi Core** | ✓ | Skor pipeline + 6 UI component + REST polling + live update |
| **Faz 2 #5 — Position Sizer + Trade Confirm** | ✓ | Entry/SL/TP/qty hesabı + risk çarpanları + onay modal'ı |
| **Faz 2 #6a — i18n Altyapı (EN/TR)** | ✓ | Global vizyon için: EN ana / TR destek, locale-aware format |
| **Faz 2 #6 — Pozisyon Sekmesi** | ✓ | OKX private REST + position card + close + onay modal |
| **Faz 2 #7 — Risk Sekmesi** | ✓ | Drawdown + adherence + locks + discipline log |
| **Hotfix #7b — Public endpoint bypass** | ✓ | OKX public endpoint (market/candles) için auth bypass |
| **Faz 2 #7c — ARCHITECTURE.md** | ✓ | Sistem mimarisi belgesi |
| **Faz 2 #8 — Exchange Adapter Pattern** | ✓ | OKX dolu + Binance/Bybit iskelet, contract test |
| **Faz 2 #8.5 — Orchestrator** | ✓ | Signal router + preflight + dedupe + "Execution ÖNCE, Notify SONRA" |
| **Faz 2 #9 — Telegram Notify** | ✓ | Bot adapter + MD V2 escape + retry + 6 mesaj kind |
| **Faz 2 #10 — P&L Sekmesi** | ✓ | Daily takvim + win rate + avg R + profit factor + max DD |
| **Faz 2 #11 — Piyasa Sekmesi** | ✓ | F&G + BTC dominance + funding + MTF trend + market summary |
| **Faz 2 #12 — Grafik Sekmesi** | ✓ | lightweight-charts + EMA20/50 + trade markers + dynamic import |
| **Faz 2 #13 — Ayarlar Genişleme** | ✓ | OKX check + Telegram test + Trading limits + Drawdown toggle |
| **Faz 2 #14 — Trade Snapshot Capture** | ✓ | TradeSnapshot store + state machine + entry context + TP/SL polling |
| **Faz 2 #15 — QUANTIX Rebrand** | ✓ | Marka kimliği + logo + favicon + OG image + metadata SEO |
| **Faz 3 #16 — E2E Testler** | ✓ | Playwright + 20 e2e test (smoke + navigation + settings + empty states) |
| **Faz 3 #17 — Performance + Optimization** | ✓ | Bundle analyzer + budget CLI + 17 test + Lighthouse rehberi |
| **Faz 3 #18 — Deploy Hazırlığı** | ✓ v2 TAMAMLANDI | Vercel config + smoke test + CI workflow + DEPLOY.md |
| **v3 #19 — OKX WS Trade Feed + Ring Buffer** | ✓ | Per-pair stream, 78 test, throttle + reconnect + heartbeat |
| **v3 #20 — CVD + Delta Divergence Engine** | ✓ | Sierra-tier multi-frame (1m/5m/15m), 42 test, VETO mekanizması |
| **v3 #21 — VPIN Engine** | ✓ 🏆 DÜNYADA İLK | Easley-López de Prado-O'Hara 2012 matematik, retail otomasyonda ücretsiz, 29 test |
| **v3 #22 — SMC Detector** | ✓ 🔥 VİRAL | Order Block + Liquidity Grab + FVG otomatik, 23 test |
| **v3 #23 — Estimated Liquidation Map** | ✓ | Hyblock-tier magnet zone, 17 test |
| **v3 #24 — Flow Intelligence Pipeline** | ✓ | Score Engine bypass adaptör, 13 test |
| **v3 #25 — UI Overhaul: QUANTIX OS Aggressive** | **✓ v3 TAMAMLANDI** | FlowAlignmentRow + glassmorphism + gradient orbs + v3 branding |
| 1b paket #5e — Pullback Engine | — | Entry mantığı + sweep entegrasyonu |
| 1b paket #6 — Forward Test | — | log, evaluate, stats |
| 1b paket #7 — Macro & Regime | — | F&G, BTC dominance, display regime |
| 2 — UI inşa | — | 7 sekmenin React versiyonu |
| 3 — Paralel doğrulama | — | Eski vs yeni paralel: backtest birebir |
| 4 — Geçiş | — | `ug52_*` migration scripti, eski panel emekli |
| 5 — Ralli filtreleri + rejim motoru | — | Temiz zeminde yeni özellikler |

## Faz 1a Tamamlandı: İndikatörler

8 indikatörün hepsi v55.51 panel ile **ULP-seviyesinde birebir** (IEEE 754
hassasiyetinde, `toBe` ile karşılaştırılıyor — yaklaşık değer değil):

| İndikatör | Dosya | Birim test | Parity test |
|-----------|-------|------------|-------------|
| RSI (Wilder) | `lib/indicators/rsi.ts` | 8 | 6 (100 seed dahil) |
| EMA | `lib/indicators/ema.ts` | 4 | 100 seed |
| BB (population variance) | `lib/indicators/bb.ts` | 3 | 100 seed |
| ATR (basit SMA of TR) | `lib/indicators/atr.ts` | 3 | 100 seed |
| ATR Percentile | `lib/indicators/atr-percentile.ts` | 2 | 100 seed |
| VWAP (daily anchored) | `lib/indicators/vwap.ts` | 2 | 20 seed (timer fake) |
| Volume Ratio | `lib/indicators/volume-ratio.ts` | 3 | 100 seed |
| ADX (Wilder smoothed sum) | `lib/indicators/adx.ts` | 2 | 100 seed |

**Toplam: 44 test geçiyor. 0 sapma.**

Önemli ayrıntılar (panel davranışı korundu):
- **BB** sample değil **population variance** (`/n`)
- **ATR** Wilder smoothing **DEĞİL**, basit SMA of TR
- **ATR Percentile** empirical CDF, regime: compression/normal/expansion/extreme
- **VWAP** daily-anchored (UTC 00:00 reset), 1-sigma volume-weighted bands
- **ADX** iç wilderSmooth özel: smoothed **sum** (ortalama değil), ama ADX kendisi klasik Wilder ortalaması
- Tüm IEEE 754 ULP detayları korundu (`Math.pow`, `**`, parantez sırası)


## Geliştirme Komutları

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript hata kontrolü |
| `npm test` | Tüm Vitest testleri (unit + integration) |
| `npm run test:parity` | Yalnızca eski-yeni uyum testleri |
| `npm run test:watch` | Test izleme modu |
| `npm run e2e` | Playwright E2E testler (dev server otomatik başlar) |
| `npm run e2e:ui` | Playwright UI mode (debug için) |
| `npm run e2e:install` | İlk kurulumda: Chromium binary indir (~150MB, bir kez) |
| `npm run analyze` | Bundle treemap (ANALYZE=true) — tarayıcıda interaktif görüntü |
| `npm run perf:check` | Bundle bütçesi sertifikası (fail = exit 1, CI gate) |
| `npm run smoke -- URL` | Production smoke test (post-deploy sağlık kontrolü) |

## Önemli Kurallar

1. **`any` tipi kullanma.** Bilinmiyorsa `unknown` + Zod.
2. **`localStorage` doğrudan yazma.** Zustand persist middleware kullan.
3. **OKX secret `'use client'` dosyalarında okuma.** Sadece `app/api/*`.
4. **Test ve parity testi yazılmamış indicator merge edilmez.** Bu kuralın amacı tek: Faz 3'te şaşırmamak.
5. **PAIRS = ['BTC', 'ETH']** — değiştirme. SOL/BNB/XRP/meme coin ekleme isteği = strategy drift.
6. **Eski panel referans.** Davranış değişikliği önermeden önce mevcut kod oku.

## Güvenlik Mimarisi (Paket #3 ile)

OKX secret browser bundle'ına **asla** girmez. Akış:

```
Browser  →  /api/okx/<path>        (kendi server'ımıza, secret YOK)
Server   →  buildOkxHeaders        (process.env'den secret okunur)
Server   →  https://www.okx.com    (imzalı istek)
Server   →  Zod validate           (bozuk yanıt = açık hata)
Browser  ←  ParsedOkxResponse      (sadece sonuç)
```

**Build sonrası doğrulama protokolü** — Her major release öncesi:

```powershell
# Sahte tanınabilir secret'larla build
# .env.local'a OKX_API_KEY=PROD_KEY_LEAK_CHECK_xxx vb. yaz
npm run build

# Client bundle'da sızıntı var mı?
findstr /S "LEAK_CHECK" .next\static\
# Çıktı boş olmalı.
```

Çıktı boş değilse: **release edilmez**. Bir yerden secret browser'a sızıyor.
Bu protokolün ilk uygulaması: BUG_LOG.md AC-3.3.

## Çift Katmanlı Kontrol Süreci (Paket #3'ten itibaren)

Her paket için iki katman doğrulama:

**Katman 1 — Statik:**
- Panel kodu yan yana, port edilen TS satır satır karşılaştırılır
- `tsc --noEmit` strict mode → 0 hata zorunlu
- Her public fonksiyon en az 1 birim test + parity test

**Katman 2 — Davranış:**
- Birim test: kenar koşullar (null, 0, negatif, hatalı tip)
- Parity test: eski panel kodu birebir kopyası vs TS port, `toBe` strict equality
- Bilinen vektör testleri (kritik kriptografik kod için, BUG_LOG AC-3.1)
- Edge case stress: network fail, race condition, eş zamanlı çağrılar
- **Yan kanal doğrulama**: bilgisayar dışında bağımsız araç (Python `hmac` vs)

Her bulgu `BUG_LOG.md`'ye kaydedilir, `AC-{paket}-{sıra}` ID'siyle.
deploy
