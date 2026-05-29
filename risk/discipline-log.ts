/**
 * DISCIPLINE LOG — v55.51 ile birebir.
 * Kaynak: panel_v55_51.html satır 5194-5215.
 *
 * Panel verdict'leri ve kullanıcı trade aksiyonlarını kaydeder.
 * "Sistem uyumu" (system adherence) skorlamasının veri kaynağı.
 *
 * Kurallar (panel ile birebir):
 *   - 30 gün retention → eski entry'ler load'da prune edilir
 *   - 5000 cap → eklenirken aşılırsa en eski kayıtlar atılır (slice(-5000))
 *   - Cap büyüme tarihi: v55.3 (500→2000), v55.15 (2000→5000)
 *
 * Bu modül SADECE log yönetimi yapar. "Sistem uyumu skoru" hesaplama mantığı
 * (verdict_go vs system_against takibi) ayrı bir modülde olacak (UI sekmesi).
 */

import type { StorageLike } from "@/lib/trailing/persistence";

const STORAGE_KEY = "ug52_disc_log";
const RETENTION_MS = 30 * 86400000; // 30 gün
const CAP = 5000;

export type DisciplineEventType =
  | "verdict_go"
  | "verdict_no"
  | "trade_open"
  | "trade_close"
  | "system_against" // panel uyarı veriyordu ama kullanıcı trade etti
  | "system_with" // panel onay verdi, kullanıcı trade etti
  | (string & {}); // ileride eklenecek tipler için açık (TypeScript trick)

export interface DisciplineEntry {
  ts: number;
  type: DisciplineEventType;
  // Esnek ek alanlar (pair, skor vs). Panel `...extra` ile genişletiyor.
  [key: string]: unknown;
}

export class DisciplineLog {
  private entries: DisciplineEntry[] = [];
  private storage: StorageLike | null;

  /**
   * @param storage localStorage abstraction (null = persist yok)
   * @param now Test edilebilirlik için zaman override; varsayılan Date.now()
   */
  constructor(storage: StorageLike | null = null, now: number = Date.now()) {
    this.storage = storage;
    this.load(now);
  }

  /**
   * LS'den yükle + 30 günden eski entry'leri prune et.
   * Panel `loadDisciplineLog` (satır 5196-5202) ile birebir.
   */
  private load(now: number = Date.now()): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        this.entries = [];
        return;
      }
      const cutoff = now - RETENTION_MS;
      this.entries = parsed.filter(
        (e: unknown): e is DisciplineEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as DisciplineEntry).ts === "number" &&
          (e as DisciplineEntry).ts >= cutoff,
      );
      this.persist();
    } catch {
      this.entries = [];
    }
  }

  /**
   * Yeni entry ekle. Panel `logDiscipline` (satır 5204-5215) ile birebir.
   * Cap aşılırsa en eski kayıtlar atılır (slice(-5000)).
   */
  log(
    type: DisciplineEventType,
    extra: Record<string, unknown> = {},
    now: number = Date.now(),
  ): void {
    const entry: DisciplineEntry = { ts: now, type, ...extra };
    this.entries.push(entry);
    if (this.entries.length > CAP) {
      this.entries = this.entries.slice(-CAP);
    }
    this.persist();
  }

  /**
   * Tüm entry'leri döndür (UI için). Read-only — dışarıdan mutasyon edilmemeli.
   */
  getAll(): readonly DisciplineEntry[] {
    return this.entries;
  }

  /**
   * Belirli bir zaman aralığındaki entry'leri filtre et.
   * @param fromMs ms timestamp (dahil)
   * @param toMs ms timestamp (dahil)
   */
  getRange(fromMs: number, toMs: number): DisciplineEntry[] {
    return this.entries.filter((e) => e.ts >= fromMs && e.ts <= toMs);
  }

  /** Belirli tip(ler)deki entry'leri filtre et. */
  getByType(types: readonly DisciplineEventType[]): DisciplineEntry[] {
    const set = new Set(types);
    return this.entries.filter((e) => set.has(e.type));
  }

  /** Manuel temizleme (backup restore vs için). */
  clear(): void {
    this.entries = [];
    this.persist();
  }

  /** Backup-restore için içe aktarma. */
  replaceAll(entries: DisciplineEntry[]): void {
    this.entries = Array.isArray(entries) ? entries.slice(-CAP) : [];
    this.persist();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // sessizce yut — panel davranışıyla aynı
    }
  }
}

export const DISCIPLINE_CONSTANTS = {
  STORAGE_KEY,
  RETENTION_MS,
  CAP,
} as const;
