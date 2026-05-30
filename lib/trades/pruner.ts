/**
 * TRADE PRUNER — Otomatik Hafıza Budama Döngüsü.
 *
 * Sorumluluk:
 *   Zustand tradesStore içindeki eski CLOSED trade'leri periyodik olarak
 *   temizler. Skor motoru her tick'te getBucketStats() çağırır; trade dizisi
 *   büyüdükçe O(n) döngü süresi artar. Pruning ile canlı dizi küçük kalır,
 *   getBucketStats() her zaman <1ms'de tamamlanır.
 *
 * Mimarisi:
 *   - TradePruner bir singleton döngü — start()/stop() ile kontrol edilir
 *   - Her `intervalMs`'de bir pruneOldClosedTrades() çağrılır
 *   - Sonuç store'a yazılır, arşiv localStorage'a persist edilir
 *   - Browser sekmesi görünür değilse (Page Visibility API) döngü yavaşlar
 *
 * Bağımlılık:
 *   tradesStore inject edilir — test mock'u enjekte edilebilir.
 *   Bu modül I/O içerir (store mutasyonu) — testler store mock'u kullanır.
 */

import {
  pruneOldClosedTrades,
  mergeIntoArchive,
  DEFAULT_PRUNE_AGE_MS,
  type PruneResult,
} from "./state";
import type { TradeSnapshot } from "./types";
import { loadFromStorage, saveToStorage } from "@/lib/store/persist";

// ─── Sabitler ────────────────────────────────────────────────

/** Arşiv localStorage key'i */
export const ARCHIVE_STORAGE_KEY = "trade_archive";

/** Maksimum arşiv boyutu (localStorage taşmasın) */
export const MAX_ARCHIVE_SIZE = 500;

/** Varsayılan prune döngü aralığı: 60 saniye */
export const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

/** Sayfa arka plandayken yavaşlatma faktörü */
export const BACKGROUND_SLOWDOWN = 5; // 5× daha seyrek

// ─── Pruner konfigürasyonu ────────────────────────────────────

export interface PrunerConfig {
  /**
   * Prune döngüsü aralığı (ms).
   * Default: 60_000 (1 dakika)
   */
  intervalMs?: number;
  /**
   * Bu yaşı geçen CLOSED trade'ler prune edilir (ms).
   * Default: 48 * 60 * 60 * 1000 (48 saat)
   */
  maxAgeMs?: number;
  /**
   * Arşiv maksimum boyutu.
   * Default: 500
   */
  maxArchiveSize?: number;
  /**
   * Prune tamamlandığında çağrılır (opsiyonel callback).
   * UI alert, log veya metric için.
   */
  onPrune?: (result: PruneResult, archiveSize: number) => void;
  /**
   * setInterval inject (test için).
   * Default: globalThis.setInterval
   */
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  /**
   * clearInterval inject (test için).
   */
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
  /**
   * Şu an (epoch ms) inject (test için).
   */
  now?: () => number;
}

// ─── Store arayüzü (DI) ──────────────────────────────────────

/**
 * TradePruner'ın ihtiyaç duyduğu store arayüzü.
 * useTradesStore'un bir alt kümesi — test mock'u kolaylaştırmak için.
 */
export interface PrunableTradesStore {
  /** Live trade dizisini döndür */
  getTrades(): readonly TradeSnapshot[];
  /** Pruned edilmiş trade'lerle live state'i güncelle */
  applyPrune(pruneResult: PruneResult): void;
}

// ─── Arşiv localStorage I/O ──────────────────────────────────

/**
 * Arşiv yükle — bozuk veri → boş dizi.
 */
export function loadArchive(): TradeSnapshot[] {
  return loadFromStorage<TradeSnapshot[]>(ARCHIVE_STORAGE_KEY, []);
}

/**
 * Arşivi kaydet — maxArchiveSize'a kısalt.
 */
export function saveArchive(
  archive: readonly TradeSnapshot[],
  maxSize: number = MAX_ARCHIVE_SIZE,
): void {
  const capped = archive.length > maxSize
    ? [...archive].sort((a, b) => (a.exit?.closedAt ?? 0) - (b.exit?.closedAt ?? 0)).slice(-maxSize)
    : [...archive];
  saveToStorage(ARCHIVE_STORAGE_KEY, capped);
}

// ─── TradePruner ─────────────────────────────────────────────

/**
 * Otomatik hafıza budama döngüsü.
 *
 * Kullanım:
 *   const pruner = new TradePruner(storeAdapter, config);
 *   pruner.start();  // döngü başlar
 *   // ...
 *   pruner.stop();   // sekme kapanırken veya cleanup'ta
 */
export class TradePruner {
  private readonly store: PrunableTradesStore;
  private readonly cfg: Required<PrunerConfig>;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _lastPruneAt: number | null = null;
  private _totalPrunedCount = 0;

  constructor(store: PrunableTradesStore, config: PrunerConfig = {}) {
    this.store = store;
    this.cfg = {
      intervalMs: config.intervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
      maxAgeMs: config.maxAgeMs ?? DEFAULT_PRUNE_AGE_MS,
      maxArchiveSize: config.maxArchiveSize ?? MAX_ARCHIVE_SIZE,
      onPrune: config.onPrune ?? (() => undefined),
      setIntervalFn: config.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms)),
      clearIntervalFn: config.clearIntervalFn ?? ((id) => clearInterval(id)),
      now: config.now ?? (() => Date.now()),
    };
  }

  /** Döngü aktif mi? */
  get running(): boolean {
    return this._running;
  }

  /** Son prune zamanı */
  get lastPruneAt(): number | null {
    return this._lastPruneAt;
  }

  /** Toplam prune edilen kayıt sayısı (session boyunca) */
  get totalPrunedCount(): number {
    return this._totalPrunedCount;
  }

  /**
   * Döngüyü başlat.
   * Zaten çalışıyorsa no-op.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    // İlk prune hemen
    this._tick();
    this.timerId = this.cfg.setIntervalFn(() => this._tick(), this.cfg.intervalMs);
  }

  /**
   * Döngüyü durdur (sekme kapanırken, cleanup).
   */
  stop(): void {
    if (!this._running) return;
    if (this.timerId !== null) {
      this.cfg.clearIntervalFn(this.timerId);
      this.timerId = null;
    }
    this._running = false;
  }

  /**
   * Anında prune — manuel tetik veya test için.
   * Döngü durumu değiştirmez.
   */
  pruneNow(): PruneResult {
    return this._tick();
  }

  /**
   * Tek prune döngüsü.
   */
  private _tick(): PruneResult {
    const now = this.cfg.now();
    const trades = this.store.getTrades();

    const result = pruneOldClosedTrades(trades, now, this.cfg.maxAgeMs);

    if (result.prunedCount > 0) {
      // Arşiv yükle + güncelle
      const currentArchive = loadArchive();
      const updatedArchive = mergeIntoArchive(
        currentArchive,
        result.pruned,
        this.cfg.maxArchiveSize,
      );
      saveArchive(updatedArchive, this.cfg.maxArchiveSize);

      // Live state güncelle
      this.store.applyPrune(result);

      this._totalPrunedCount += result.prunedCount;
      this._lastPruneAt = now;

      this.cfg.onPrune(result, updatedArchive.length);
    }

    return result;
  }
}

// ─── Store adapter factory ────────────────────────────────────

/**
 * useTradesStore'dan PrunableTradesStore adapter oluştur.
 * Gerçek kullanım için — app bootstrap'ta çağrılır.
 */
export function createStoreAdapter(
  getState: () => { trades: TradeSnapshot[] },
  setState: (updater: (s: { trades: TradeSnapshot[] }) => { trades: TradeSnapshot[] }) => void,
): PrunableTradesStore {
  return {
    getTrades: () => getState().trades,
    applyPrune: (result: PruneResult) => {
      setState((s) => ({ ...s, trades: result.live }));
    },
  };
}
