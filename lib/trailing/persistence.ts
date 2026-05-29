/**
 * TRAIL PERSISTENCE — v55.51 panel ile birebir.
 *
 * Mode izolasyonu (v55.51 yeniliği):
 *   ug52_trails_prod  → gerçek hesap trail'leri
 *   ug52_trails_demo  → demo hesap trail'leri
 *   ug52_trails       → ESKİ tek key, otomatik prod'a migrate edilir
 *
 * Kaynak: panel_v55_51.html satır 11069-11129.
 *
 * Test edilebilirlik: tüm I/O `Storage` interface üzerinden — `localStorage`
 * yerine in-memory mock geçilebilir. Node.js testleri global'e dokunmaz.
 */

import {
  KademeliTrailingStop,
  type TrailSnapshot,
  type Yon,
} from "./kademeli";

/** Trail state — her instId için tutulan bağlam. */
export interface TrailState {
  instance: KademeliTrailingStop;
  /** Son işlenmiş 4H mum kapanış zamanı (duplicate tick koruması) */
  last4hCloseTs: number;
  /** Ralli modu aktif mi (TP1 iptal edildi mi) */
  rallyActivated: boolean;
  /** Pozisyon giriş fiyatı (instance dışında ayrıca tutulur — pozisyon değişebilir) */
  giris_fiyat: number;
}

export type TrailsByInstId = Record<string, TrailState>;

/** Persistence için snapshot — instance metodu değil, plain JSON-safe obje. */
export interface TrailStateSnapshot extends TrailSnapshot {
  last4hCloseTs: number;
  rallyActivated: boolean;
  giris_fiyat: number;
}

/**
 * localStorage abstraction — Storage Web API'siyle uyumlu minimal set.
 * Browser'da: `window.localStorage` geçilir.
 * Test/Node: bellek tabanlı mock geçilir.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Hangi mode'dayız → hangi key. Panel `_trailKey()` ile birebir.
 */
export function trailKey(isDemo: boolean): string {
  return "ug52_trails_" + (isDemo ? "demo" : "prod");
}

/**
 * Eski tek-key formatından mode-bazlı formata göç.
 * İlk yüklemede bir kez çalıştırılır, idempotent.
 *
 * Kaynak: panel satır 11077-11086.
 */
export function migrateOldTrailKey(storage: StorageLike): boolean {
  try {
    const oldRaw = storage.getItem("ug52_trails");
    if (oldRaw && !storage.getItem("ug52_trails_prod")) {
      storage.setItem("ug52_trails_prod", oldRaw);
      storage.removeItem("ug52_trails");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Aktif trail'leri localStorage'a kaydet.
 * Kaynak: panel `_saveTrails` satır 11088-11106.
 */
export function saveTrails(
  trails: TrailsByInstId,
  storage: StorageLike,
  isDemo: boolean,
): boolean {
  try {
    const serializable: Record<string, TrailStateSnapshot> = {};
    for (const [instId, t] of Object.entries(trails)) {
      const snap = t.instance.toSnapshot();
      serializable[instId] = {
        ...snap,
        last4hCloseTs: t.last4hCloseTs,
        rallyActivated: t.rallyActivated,
        giris_fiyat: t.giris_fiyat,
      };
    }
    storage.setItem(trailKey(isDemo), JSON.stringify(serializable));
    return true;
  } catch {
    return false;
  }
}

/**
 * localStorage'dan trail'leri restore et.
 * Kaynak: panel `_loadTrails` satır 11108-11129.
 *
 * Eksik alanlar (`en_yuksek_kar_yuzde`, `son_atr_carpan`) eski formattan
 * gelirse varsayılan değerlerle doldurulur (panel davranışı birebir).
 */
export function loadTrails(
  storage: StorageLike,
  isDemo: boolean,
): TrailsByInstId {
  const out: TrailsByInstId = {};
  try {
    const raw = storage.getItem(trailKey(isDemo));
    if (!raw) return out;
    const data = JSON.parse(raw) as Record<string, Partial<TrailStateSnapshot>>;
    for (const [instId, st] of Object.entries(data)) {
      if (!st.yon) continue; // korumalı: bozuk kayıt
      const snap: TrailSnapshot = {
        yon: st.yon as Yon,
        en_iyi_fiyat: st.en_iyi_fiyat ?? null,
        en_yuksek_kar_yuzde: st.en_yuksek_kar_yuzde ?? 0,
        aktif_stop: st.aktif_stop ?? null,
        cikis_tetiklendi: !!st.cikis_tetiklendi,
        son_atr_carpan: st.son_atr_carpan ?? 2.0,
      };
      out[instId] = {
        instance: KademeliTrailingStop.fromSnapshot(snap),
        last4hCloseTs: st.last4hCloseTs ?? 0,
        rallyActivated: !!st.rallyActivated,
        giris_fiyat: st.giris_fiyat ?? 0,
      };
    }
  } catch {
    // Bozuk JSON → boş döndür, panelin davranışıyla uyumlu (warn'lar log'da)
  }
  return out;
}
