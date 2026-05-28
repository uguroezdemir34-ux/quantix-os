# Deploy Rehberi — QUANTIX v2

Production'a alma adımları, env değişkenleri, smoke test ve rollback yordamı.

## İçindekiler

1. [Vercel deploy (önerilen)](#vercel-deploy-önerilen)
2. [Render deploy (alternatif)](#render-deploy-alternatif)
3. [Self-host (VPS + Docker)](#self-host-vps--docker)
4. [Environment variables](#environment-variables)
5. [Post-deploy smoke test](#post-deploy-smoke-test)
6. [DNS & SSL](#dns--ssl)
7. [Rollback prosedürü](#rollback-prosedürü)

---

## Vercel deploy (önerilen)

Next.js Vercel'in evi — sıfır config deploy.

### İlk kurulum

1. **GitHub'a push et** — kod henüz github'da değilse:
   ```bash
   git init
   git add .
   git commit -m "Initial QUANTIX v2"
   git remote add origin git@github.com:USERNAME/quantix.git
   git push -u origin main
   ```

2. **Vercel'e import et:**
   - https://vercel.com/new
   - GitHub repo seç → "Import"
   - Framework: Next.js otomatik algılanır
   - Root directory: `./` (default)
   - Build: `npm run build` (otomatik)
   - Output: `.next` (otomatik)

3. **Environment variables ekle** (Vercel UI → Project Settings → Environment Variables):

   `.env.production.example`'daki tüm değişkenleri ekle. **Production** scope'una yaz, preview branch'leri için ayrıca isteğe bağlı:

   | Key | Scope | Açıklama |
   |-----|-------|----------|
   | `OKX_API_KEY` | Production | OKX live key |
   | `OKX_API_SECRET` | Production | OKX live secret |
   | `OKX_API_PASSPHRASE` | Production | OKX passphrase |
   | `OKX_DEMO_API_KEY` | All | (opsiyonel) OKX demo |
   | `OKX_DEMO_API_SECRET` | All | (opsiyonel) |
   | `OKX_DEMO_API_PASSPHRASE` | All | (opsiyonel) |
   | `TELEGRAM_BOT_TOKEN` | Production | VIP bot token |
   | `TELEGRAM_VIP_CHAT_ID` | Production | VIP chat ID |
   | `NEXT_PUBLIC_APP_URL` | Production | https://quantix.example.com |

4. **Deploy** — "Deploy" butonu. İlk build 2-3 dakika sürer.

5. **Custom domain (opsiyonel):** Vercel Project Settings → Domains → kendi domain'ini ekle.

### Sonraki deploy'lar

`main` branch'e her push otomatik production deploy tetikler.  
Pull request → preview deploy (ayrı URL).

### Region

`vercel.json` `regions: ["fra1"]` (Frankfurt) — Türkiye'ye en yakın Vercel edge.

---

## Render deploy (alternatif)

Vercel'i kullanamıyorsan (örn. fiyat) Render.com benzeri çalışır.

1. https://render.com → New Web Service
2. GitHub repo bağla
3. Settings:
   - **Build command:** `npm install --legacy-peer-deps && npm run build`
   - **Start command:** `npm start`
   - **Node version:** 20.x
4. Environment variables — Vercel'deki gibi ekle
5. Deploy

---

## Self-host (VPS + Docker)

Tam kontrol istiyorsan (DigitalOcean / Hetzner / kendi sunucun):

### Dockerfile yok ama Next standalone build var

```bash
# Sunucuda
git clone YOUR_REPO
cd quantix
npm install --legacy-peer-deps
npm run build

# .env.local oluştur (gerçek değerlerle)
cp .env.production.example .env.local
nano .env.local

# Production server başlat
npm start
# Port 3000'de dinler

# Arka planda çalıştırmak için pm2 öneriyoruz:
npm install -g pm2
pm2 start "npm start" --name quantix
pm2 save
pm2 startup
```

### Nginx reverse proxy (HTTPS için)

```nginx
server {
    listen 443 ssl http2;
    server_name quantix.example.com;

    ssl_certificate     /etc/letsencrypt/live/quantix.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/quantix.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Let's Encrypt SSL

```bash
sudo certbot --nginx -d quantix.example.com
```

---

## Environment variables

`.env.production.example` referans dosya. Production'da **her zaman** doldurulması gereken:

- `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` — Trade işlemleri için
- `NEXT_PUBLIC_APP_URL` — SEO meta + OG image için

Opsiyonel:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_VIP_CHAT_ID` — Bildirimler için (yoksa panel çalışır ama mesaj göndermez)
- `OKX_DEMO_*` — Demo modu için (yoksa demo toggle deaktif)

### Güvenlik notu

OKX key'leri **withdraw permission'ı OLMADAN** oluştur. Sadece "Trade" permission yeterli. Eğer key sızarsa para çekilemez.

---

## Post-deploy smoke test

Deploy bittikten **hemen sonra** koş:

```bash
npm run smoke -- https://quantix.example.com
```

Veya `NEXT_PUBLIC_APP_URL` env varsa:

```bash
npm run smoke
```

Beklenen çıktı:

```
=== PRODUCTION SMOKE TEST ===
URL: https://quantix.example.com

  ✓ Home page (root redirect)               [200] (45ms)
  ✓ Karar (decision) page                   [200] (120ms)
  ✓ Ayarlar (settings) page                 [200] (98ms)
  ✓ OKX config check endpoint               [200] (210ms)
  ✓ Macro F&G endpoint                      [200] (1850ms)
  ✓ Favicon                                 [200] (15ms)

Total: 6 · Passed: 6 · Failed: 0
✓ ALL CHECKS PASSED
```

Bir tane bile fail varsa → **deploy'u rollback et** (aşağıya bak).

---

## DNS & SSL

### Vercel kullanıyorsan

1. Vercel Project Settings → Domains → "Add"
2. `quantix.example.com` ekle
3. Vercel sana DNS kayıtları verir (A veya CNAME)
4. Domain sağlayıcında (GoDaddy / Cloudflare / vs.) bu kayıtları gir
5. SSL otomatik (Let's Encrypt) — 2-5 dakika

### Self-host

1. Domain sağlayıcı → A record → sunucu IP'si
2. SSH ile sunucuya bağlan, certbot çalıştır
3. nginx config'i güncelle (yukarıdaki örnek)
4. `sudo nginx -s reload`

---

## Rollback prosedürü

### Vercel

Vercel her deploy'u immutable URL ile saklar.

1. Vercel Dashboard → Project → Deployments
2. Önceki başarılı deploy'u bul
3. "..." menüsü → "Promote to Production"
4. ~30 sn'de production geri eskiye döner

### Render

Render Dashboard → Service → Events → Rollback to previous deploy

### Self-host

```bash
cd /var/www/quantix
git log --oneline -10                # son commit'leri gör
git reset --hard <previous-commit>   # geri al
npm install --legacy-peer-deps
npm run build
pm2 restart quantix
```

---

## CI/CD

`.github/workflows/ci.yml` her PR + main push'unda otomatik çalışır:

1. **test-and-build job** — type-check + Vitest + bundle budget
2. **e2e job** — Playwright (paralel)

Her ikisi de yeşil olmadan merge engellenmeli. GitHub Repo Settings → Branches → main → "Require status checks to pass" aktif et.

---

## Production checklist (deploy öncesi)

- [ ] `.env.local` doğru doldurulmuş (lokal smoke test geçti)
- [ ] `npm run build` lokalde başarılı (warning yok)
- [ ] `npm run perf:check` PASSED
- [ ] `npm test` 1824/1824 yeşil
- [ ] `npm run e2e` 20/20 yeşil
- [ ] `BUG_LOG.md` güncel
- [ ] Vercel/host env değişkenleri set edildi
- [ ] OKX API key withdraw permission'ı KAPALI
- [ ] Telegram bot VIP kanala admin olarak eklendi
- [ ] `NEXT_PUBLIC_APP_URL` doğru domain
- [ ] DNS A/CNAME kayıtları doğru

## Sonraki adımlar

Deploy yapıldıktan sonra:

1. **Monitoring:** Vercel Analytics (built-in) veya Sentry entegrasyonu
2. **Backup:** Trade snapshots localStorage'da — kullanıcı tarayıcı verilerini silerse veri kaybolur. v3'te server-side persistence eklenebilir.
3. **Status page:** UptimeRobot ücretsiz katmanı + smoke endpoint
