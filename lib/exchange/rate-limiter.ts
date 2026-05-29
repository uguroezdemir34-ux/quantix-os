/**
 * RATE LIMITER — Token Bucket algoritması.
 *
 * OKX API limitleri (V5):
 *   Trade endpoints  : 60 req/2s = 30 req/s  (konservatif: 20 req/s alıyoruz)
 *   Algo endpoints   : 20 req/2s = 10 req/s
 *
 * Token Bucket prensibi:
 *   - Kova belirli kapasitede token tutar (max=capacity)
 *   - Her istek 1 token tüketir
 *   - Kova, refillRate token/saniye hızında dolar
 *   - Token yoksa → bir sonraki token'a kadar bekle (busy wait yok, setTimeout)
 *
 * Test edilebilirlik: now() inject edilebilir, setTimeout mock'lanabilir.
 */

export interface RateLimiterOptions {
  /** Kovadaki maksimum token sayısı (burst) */
  capacity: number;
  /** Token/saniye dolum hızı */
  refillPerSecond: number;
  /** Timer fonksiyonu (test için inject) */
  now?: () => number;
  /** setTimeout fonksiyonu (test için inject) */
  schedule?: (fn: () => void, ms: number) => void;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillAt: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  /** Bekleyen acquire() çağrılarının kuyruğu */
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(opts: RateLimiterOptions) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerSecond / 1000;
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.tokens = opts.capacity; // başlangıçta dolu
    this.lastRefillAt = this.now();
  }

  /** Mevcut token sayısını döndür (test/debug için) */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * 1 token talep et. Token varsa anında resolve, yoksa kuyrukta bekle.
   * Bu, giden her isteği kontrollü bir şekilde salar.
   */
  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (!this.draining) {
        this.drain();
      }
    });
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefillAt;
    const added = elapsed * this.refillPerMs;
    this.tokens = Math.min(this.capacity, this.tokens + added);
    this.lastRefillAt = now;
  }

  private drain(): void {
    this.draining = true;
    this.refill();

    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const resolve = this.queue.shift()!;
      resolve();
    }

    if (this.queue.length > 0) {
      // Bir sonraki token ne zaman gelecek?
      const msUntilNextToken = Math.ceil(1 / this.refillPerMs);
      this.schedule(() => {
        this.drain();
      }, msUntilNextToken);
    } else {
      this.draining = false;
    }
  }
}

// ─── OKX için hazır instance factory ────────────────────────

/** OKX trade endpoint limiti: 20 req/s (konservatif) */
export function createOkxTradeLimiter(opts?: Partial<RateLimiterOptions>): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter({
    capacity: 20,
    refillPerSecond: 20,
    ...opts,
  });
}

/** OKX algo endpoint limiti: 10 req/s */
export function createOkxAlgoLimiter(opts?: Partial<RateLimiterOptions>): TokenBucketRateLimiter {
  return new TokenBucketRateLimiter({
    capacity: 10,
    refillPerSecond: 10,
    ...opts,
  });
}
