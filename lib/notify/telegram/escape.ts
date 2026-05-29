/**
 * TELEGRAM MARKDOWN V2 — Özel karakter escape.
 *
 * Telegram Bot API'sinin MarkdownV2 parse mode'u 18 özel karakter tanır:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Bunlar kullanıcı içeriğinde GEÇTİĞİNDE escape edilmeli — yoksa
 * "Bad Request: can't parse entities" hatası alınır.
 *
 * Bu MODUL içeriği escape eder, ama formatlama karakterleri (bold için *)
 * korunur.
 *
 * Kaynak: https://core.telegram.org/bots/api#markdownv2-style
 */

/**
 * Telegram Markdown V2'de escape edilmesi gereken 18 karakter.
 * Sıralama önemli değil, hepsi tek karakter.
 */
const MD_V2_SPECIAL_CHARS = [
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
] as const;

/**
 * Düz metin → MarkdownV2-safe.
 *
 * Her özel karakterin önüne backslash ekler.
 * Mesela "BTC -0.5%" → "BTC \-0\.5%" (sayı/işaret bozulmaz)
 *
 * NOT: Bu fonksiyon "saf veri" için. Bold/italic gibi formatlama
 * eklenecekse, önce metni escape et, sonra `*${escaped}*` şeklinde sar.
 */
export function escapeMarkdownV2(text: string): string {
  if (!text) return "";
  let result = "";
  for (const ch of text) {
    // Performance: indexOf yerine binary lookup hız önemli değil burada
    if (MD_V2_SPECIAL_CHARS.includes(ch as (typeof MD_V2_SPECIAL_CHARS)[number])) {
      result += "\\" + ch;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Sayı → Markdown V2 safe string.
 * Tüm sayılarda nokta var, bu yüzden mutlaka escape gerekli.
 *
 * Örnek: 60123.45 → "60123\.45"
 * Örnek: -0.5 → "\-0\.5"
 */
export function escapeNumber(n: number): string {
  return escapeMarkdownV2(n.toString());
}

/**
 * Para birimi formatı — Markdown V2 safe.
 * Örnek: formatUsd(60123.45) → "$60,123\.45"
 *
 * Türkçe locale'de virgüllü olabilir (60.123,45), ama biz USD için her
 * zaman US format kullanırız tutarlı görünüm için.
 */
export function formatUsdMd2(amount: number, decimals: number = 2): string {
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return "$" + escapeMarkdownV2(formatted);
}

/**
 * Yüzde — Markdown V2 safe + işaretli.
 * Örnek: formatPctMd2(0.0125) → "\+1\.25%"
 * Örnek: formatPctMd2(-0.005) → "\-0\.50%"
 */
export function formatPctMd2(pct: number, decimals: number = 2): string {
  const pctValue = pct * 100;
  const sign = pctValue >= 0 ? "+" : "";
  const formatted = sign + pctValue.toFixed(decimals) + "%";
  return escapeMarkdownV2(formatted);
}

/**
 * Bold sar — içeriği önce escape eder, sonra `*...*` ile sarmalar.
 *
 * NOT: Sarma karakterleri (* *) ESCAPE EDİLMEZ — formatlama için.
 */
export function bold(text: string): string {
  return "*" + escapeMarkdownV2(text) + "*";
}

/**
 * Italic sar.
 */
export function italic(text: string): string {
  return "_" + escapeMarkdownV2(text) + "_";
}

/**
 * Inline code — `text` (parse mode'un tek istisnası: backtick içindeki
 * her şey ham, escape gerekmez — sadece backtick ve backslash escape).
 */
export function code(text: string): string {
  return "`" + text.replace(/[\\`]/g, "\\$&") + "`";
}
