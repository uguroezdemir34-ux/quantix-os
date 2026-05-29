/**
 * IDEMPOTENCY GUARD — Ghost Order Prevention.
 *
 * Problem: Borsaya emir gönderildi, ağ kesintisi oldu, yanıt alınamadı.
 * Sistem yeniden denerse aynı emir iki kez açılabilir (ghost order).
 *
 * Çözüm: Her emir için UUID v4 `clientOrderId` üret ve in-flight takip et.
 *
 * Davranış kuralları:
 *   1. Emir gönderilmeden önce clOrdId üret + kaydet (state=inflight)
 *   2. Başarılı → state=done, orderId kaydet
 *   3. Timeout → state=unknown (OKX aldı mı bilmiyoruz — retry YOK)
 *   4. Network error (bağlantı hiç kurulamadı) → state=failed → retry güvenli
 *   5. OKX uygulama hatası (code≠0) → state=failed → retry YAPMA (idempotent değil)
 *   6. Aynı clOrdId ile tekrar gönderim gelirse → mevcut Promise döner (dedup)
 *
 * Not: "unknown" state'de caller manuel kontrol yapmalı (GET /trade/order?clOrdId=...)
 */

/** Emir idempotency durumu */
export type OrderState =
  | "inflight" // İstek yolda, yanıt bekleniyor
  | "done" // Başarılı, orderId mevcut
  | "failed" // Kesin başarısız (network bağlanamadı)
  | "unknown"; // Timeout — OKX aldı mı bilinmiyor, retry tehlikeli

export interface OrderRecord {
  clOrdId: string;
  state: OrderState;
  orderId?: string; // done ise dolu
  createdAt: number;
  resolvedAt?: number;
  /** Network hatası (retry güvenli) mi yoksa timeout/uygulama hatası mı? */
  isRetryable: boolean;
}

/**
 * UUID v4 üret (crypto.randomUUID veya polyfill).
 * OKX clOrdId: max 32 char alphanum — UUID'den tire çıkarılır.
 */
export function generateClientOrderId(): string {
  let uuid: string;
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as Record<string, unknown>).crypto === "object" &&
    typeof (globalThis.crypto as Record<string, unknown>).randomUUID === "function"
  ) {
    uuid = globalThis.crypto.randomUUID();
  } else {
    // Node.js < 19 veya test ortamı polyfill
    uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  // OKX: max 32 char, only alphanumeric
  return uuid.replace(/-/g, "").slice(0, 32);
}

export class IdempotencyGuard {
  private records = new Map<string, OrderRecord>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /**
   * Yeni bir emir için clOrdId oluştur ve "inflight" kaydı aç.
   * Bu, emir gönderilmeden ÖNCE çağrılmalı.
   */
  register(): string {
    const clOrdId = generateClientOrderId();
    this.records.set(clOrdId, {
      clOrdId,
      state: "inflight",
      createdAt: this.now(),
      isRetryable: false,
    });
    return clOrdId;
  }

  /** Emir başarılı — done state'e geç */
  markDone(clOrdId: string, orderId?: string): void {
    const rec = this.records.get(clOrdId);
    if (!rec) return;
    this.records.set(clOrdId, {
      ...rec,
      state: "done",
      orderId,
      resolvedAt: this.now(),
      isRetryable: false,
    });
  }

  /**
   * Network bağlantı hatası — emir OKX'e ulaşmadı → retry güvenli.
   * Caller yeni clOrdId ile tekrar deneyebilir.
   */
  markNetworkFailed(clOrdId: string): void {
    const rec = this.records.get(clOrdId);
    if (!rec) return;
    this.records.set(clOrdId, {
      ...rec,
      state: "failed",
      resolvedAt: this.now(),
      isRetryable: true,
    });
  }

  /**
   * Timeout — OKX'in emri aldığı bilinmiyor.
   * isRetryable=false: caller manuel kontrol yapmalı.
   */
  markTimeout(clOrdId: string): void {
    const rec = this.records.get(clOrdId);
    if (!rec) return;
    this.records.set(clOrdId, {
      ...rec,
      state: "unknown",
      resolvedAt: this.now(),
      isRetryable: false,
    });
  }

  /**
   * OKX uygulama hatası (code≠0) — emir reddedildi.
   * isRetryable=false: aynı parametrelerle tekrar deneme anlamsız.
   */
  markOkxError(clOrdId: string): void {
    const rec = this.records.get(clOrdId);
    if (!rec) return;
    this.records.set(clOrdId, {
      ...rec,
      state: "failed",
      resolvedAt: this.now(),
      isRetryable: false,
    });
  }

  /** clOrdId için mevcut kaydı döndür */
  getRecord(clOrdId: string): OrderRecord | undefined {
    return this.records.get(clOrdId);
  }

  /**
   * Bu clOrdId hâlâ inflight mi? Eğer öyleyse ikinci gönderim tehlikeli.
   * Ghost order prevention: caller bunu kontrol etmeli.
   */
  isInflight(clOrdId: string): boolean {
    return this.records.get(clOrdId)?.state === "inflight";
  }

  /**
   * Bu clOrdId ile yeni istek güvenli mi?
   * false → ghost order riski var, gönderme!
   */
  isSafeToSend(clOrdId: string): boolean {
    const rec = this.records.get(clOrdId);
    if (!rec) return true; // kayıt yok → yeni emir, güvenli
    // inflight veya unknown → tehlikeli
    if (rec.state === "inflight" || rec.state === "unknown") return false;
    return true;
  }

  /** Tüm kayıtları temizle (test için) */
  clear(): void {
    this.records.clear();
  }

  /** Kayıt sayısı (test/debug için) */
  size(): number {
    return this.records.size;
  }
}
