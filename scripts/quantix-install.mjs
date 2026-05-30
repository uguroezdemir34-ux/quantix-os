// scripts/quantix-install.mjs
// pnpm quantix:install tarafından çağrılır.
// 1) .env.local yoksa .env.example'dan kopyalar
// 2) Büyük uyarı mesajı basar ve durur (kullanıcı .env.local'ı dolduracak)

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(root, "..");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const ENV_LOCAL = path.join(ROOT, ".env.local");

// ─── Renkler ─────────────────────────────────────────────────
const R = "\x1b[31m";  // kırmızı
const G = "\x1b[32m";  // yeşil
const Y = "\x1b[33m";  // sarı
const C = "\x1b[36m";  // cyan
const B = "\x1b[1m";   // kalın
const X = "\x1b[0m";   // sıfırla

function line(char = "─", n = 60) {
  return char.repeat(n);
}

// ─── 1. Bağımlılıkları yükle ─────────────────────────────────
console.log(`\n${C}${B}${line("═")}${X}`);
console.log(`${C}${B}  QUANTIX OS — Kurulum Başlıyor${X}`);
console.log(`${C}${B}${line("═")}${X}\n`);

console.log(`${Y}▶  Bağımlılıklar yükleniyor (pnpm install)...${X}\n`);
try {
  execSync("pnpm install", { stdio: "inherit", cwd: ROOT });
  console.log(`\n${G}✓  Bağımlılıklar hazır.${X}\n`);
} catch {
  console.error(`${R}✗  pnpm install başarısız. Node ve pnpm kurulu mu?${X}`);
  process.exit(1);
}

// ─── 2. .env.local kontrolü ──────────────────────────────────
if (fs.existsSync(ENV_LOCAL)) {
  console.log(`${G}✓  .env.local zaten mevcut — üzerine yazılmadı.${X}`);
  console.log(`${Y}   Mevcut ayarlarınız korundu.${X}\n`);
} else {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error(`${R}✗  .env.example bulunamadı. Repo tam indirilmiş mi?${X}`);
    process.exit(1);
  }
  fs.copyFileSync(ENV_EXAMPLE, ENV_LOCAL);
  console.log(`${G}✓  .env.local oluşturuldu (.env.example'dan kopyalandı).${X}\n`);

  // ─── Büyük uyarı ───────────────────────────────────────────
  console.log(`${R}${B}${line("█")}`);
  console.log(`  DURUN! DEVAM ETMEDEN ÖNCE YAPMANIZ GEREKEN BİR ŞEY VAR`);
  console.log(`${line("█")}${X}\n`);

  console.log(`${B}  .env.local dosyasını şimdi açın ve şu alanları doldurun:${X}\n`);

  console.log(`  ${Y}OKX DEMO (Shadow mod):${X}`);
  console.log(`    OKX_DEMO_API_KEY=`);
  console.log(`    OKX_DEMO_API_SECRET=`);
  console.log(`    OKX_DEMO_API_PASSPHRASE=\n`);

  console.log(`  ${Y}OKX CANLI (Gerçek para — acele etmeyin):${X}`);
  console.log(`    OKX_API_KEY=`);
  console.log(`    OKX_API_SECRET=`);
  console.log(`    OKX_API_PASSPHRASE=\n`);

  console.log(`  ${Y}TELEGRAM:${X}`);
  console.log(`    TELEGRAM_BOT_TOKEN=`);
  console.log(`    TELEGRAM_VIP_CHAT_ID=\n`);

  console.log(`  ${Y}ŞİFRELEME ANAHTARI (terminalde şu komutu çalıştırın):${X}`);
  console.log(`    ${C}openssl rand -base64 32${X}`);
  console.log(`    çıktıyı STATE_ENCRYPTION_KEY= alanına yapıştırın\n`);

  console.log(`  ${Y}MOD:${X}`);
  console.log(`    EXECUTION_MODE=SHADOW   ← önce bununla başlayın\n`);

  console.log(`${R}${B}${line("█")}`);
  console.log(`  Doldurduktan sonra terminale yazın: pnpm quantix:check-env`);
  console.log(`${line("█")}${X}\n`);

  process.exit(0); // başarılı çıkış — kullanıcı devam edecek
}

// .env.local zaten vardıysa kontrol et
console.log(`${Y}▶  Ortam değişkenleri kontrol ediliyor...${X}\n`);
try {
  execSync("pnpm quantix:check-env", { stdio: "inherit", cwd: ROOT });
} catch {
  console.log(`\n${R}  Yukarıdaki eksikleri .env.local dosyasına ekleyin,`);
  console.log(`  ardından tekrar çalıştırın: ${B}pnpm quantix:check-env${X}\n`);
  process.exit(1);
}

console.log(`\n${G}${B}${line("═")}`);
console.log(`  QUANTIX OS kuruluma hazır!`);
console.log(`  Başlatmak için: pnpm dev  (geliştirme)`);
console.log(`  Production:     pnpm quantix:up`);
console.log(`${line("═")}${X}\n`);
