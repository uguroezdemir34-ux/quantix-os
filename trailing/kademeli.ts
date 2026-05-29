/**
 * KADEMELİ TRAILING STOP — v55.51 panel sınıfının birebir TS portu.
 * Kaynak: panel_v55_51.html satır 6425-6493.
 *
 * Davranış v55.51 ile BİREBİR aynı tutuldu. Bilinen eksiklikler (Faz 1b paket #3'te
 * "iyileştirme" olarak ele alınacak, bu portta KORUNUYOR):
 *   - ATR=0 sınıf içinde korunmuyor (dışarıdan kontrol gerekir)
 *   - SHORT'ta ilk en_iyi_fiyat girişin üstündeyse peak_kar negatif olabilir
 *   - cikis_tetiklendi restore edildiğinde OKX state ile senkronizasyon yok
 *
 * TASARIM KARARLARI (panel'den korunan, hata değil):
 *   1. Peak ratchet: ATR çarpanı anlık değil, görülen en yüksek kâra göre.
 *      %5 görüldü → 1.0x; sonra %4'e gerilesen bile 1.0x kalır (1.5'a açılmaz).
 *   2. Stop referansı en_iyi_fiyat (zirve), suanki_fiyat değil.
 *   3. Stop tek yönlü: LONG'ta sadece yukarı, SHORT'ta sadece aşağı.
 *   4. Çıkış kapanış fiyatıyla; intra-bar wick'ler görmezden gelinir.
 */

export type Yon = "LONG" | "SHORT";

export interface GuncelleSonuc {
  stop_fiyat: number | null;
  cikis_sinyali: boolean;
}

export interface TrailDurum {
  yon: Yon;
  en_iyi_fiyat: number | null;
  peak_kar_yuzde: number;
  atr_carpan: number;
  aktif_stop: number | null;
  cikis: boolean;
}

/**
 * Persistence için minimal snapshot.
 * localStorage'a yazılan ve `fromSnapshot` ile geri yüklenen alanlar.
 */
export interface TrailSnapshot {
  yon: Yon;
  en_iyi_fiyat: number | null;
  en_yuksek_kar_yuzde: number;
  aktif_stop: number | null;
  cikis_tetiklendi: boolean;
  son_atr_carpan: number;
}

export class KademeliTrailingStop {
  yon: Yon;
  en_iyi_fiyat: number | null;
  en_yuksek_kar_yuzde: number;
  aktif_stop: number | null;
  cikis_tetiklendi: boolean;
  son_atr_carpan: number;

  constructor(pozisyon_yonu: Yon = "LONG") {
    // Tip sistemi sayesinde panele göre fazladan koruma: string normalize
    const normalized = pozisyon_yonu.toUpperCase() as Yon;
    if (normalized !== "LONG" && normalized !== "SHORT") {
      throw new Error(`KademeliTrailingStop: geçersiz yön: ${pozisyon_yonu}`);
    }
    this.yon = normalized;
    this.en_iyi_fiyat = null;
    this.en_yuksek_kar_yuzde = 0;
    this.aktif_stop = null;
    this.cikis_tetiklendi = false;
    this.son_atr_carpan = 2.0;
  }

  /**
   * ATR çarpanı — peak kâra göre belirlenir (ratchet).
   * Eşikler v55.51 paneliyle birebir aynı.
   */
  private _atrCarpaniBelirle(kar_yuzde: number): number {
    if (kar_yuzde >= 10) return 0.75;
    if (kar_yuzde >= 5) return 1.0;
    if (kar_yuzde >= 2) return 1.5;
    return 2.0;
  }

  /**
   * Her yeni mum kapanışında çağrılır.
   *
   * @param giris_fiyat Pozisyonun açıldığı fiyat (sabit, instance ömrü boyunca aynı)
   * @param suanki_fiyat Mevcut piyasa fiyatı (peak takibi için)
   * @param ATR_degeri Mevcut ATR değeri (stop mesafesi hesabı için)
   * @param kapanis_fiyat Son kapanmış mumun kapanış fiyatı (çıkış kontrolü için)
   */
  guncelle(
    giris_fiyat: number,
    suanki_fiyat: number,
    ATR_degeri: number,
    kapanis_fiyat: number,
  ): GuncelleSonuc {
    // Zaten çıkış tetiklendiyse aynen döndür (idempotent).
    if (this.cikis_tetiklendi) {
      return { stop_fiyat: this.aktif_stop, cikis_sinyali: true };
    }

    // 1. En iyi fiyatı güncelle (LONG için max, SHORT için min)
    if (this.en_iyi_fiyat === null) {
      this.en_iyi_fiyat = suanki_fiyat;
    } else if (this.yon === "LONG" && suanki_fiyat > this.en_iyi_fiyat) {
      this.en_iyi_fiyat = suanki_fiyat;
    } else if (this.yon === "SHORT" && suanki_fiyat < this.en_iyi_fiyat) {
      this.en_iyi_fiyat = suanki_fiyat;
    }

    // 2. Peak kâr yüzdesi
    let peak_kar: number;
    if (this.yon === "LONG") {
      peak_kar = ((this.en_iyi_fiyat - giris_fiyat) / giris_fiyat) * 100;
    } else {
      peak_kar = ((giris_fiyat - this.en_iyi_fiyat) / giris_fiyat) * 100;
    }
    if (peak_kar > this.en_yuksek_kar_yuzde) {
      this.en_yuksek_kar_yuzde = peak_kar;
    }

    // 3. ATR çarpanı + stop mesafesi
    const atr_carpan = this._atrCarpaniBelirle(this.en_yuksek_kar_yuzde);
    this.son_atr_carpan = atr_carpan;
    const stop_mesafe = ATR_degeri * atr_carpan;

    // 4. Yeni stop hesapla (tek yönlü ratchet)
    let yeni_stop: number;
    if (this.yon === "LONG") {
      yeni_stop = this.en_iyi_fiyat - stop_mesafe;
      if (this.aktif_stop === null || yeni_stop > this.aktif_stop) {
        this.aktif_stop = yeni_stop;
      }
    } else {
      yeni_stop = this.en_iyi_fiyat + stop_mesafe;
      if (this.aktif_stop === null || yeni_stop < this.aktif_stop) {
        this.aktif_stop = yeni_stop;
      }
    }

    // 5. Çıkış kontrolü — SADECE kapanış fiyatı, wick ignore
    let cikis = false;
    if (this.aktif_stop !== null) {
      if (this.yon === "LONG") cikis = kapanis_fiyat <= this.aktif_stop;
      else cikis = kapanis_fiyat >= this.aktif_stop;
    }
    if (cikis) this.cikis_tetiklendi = true;

    return { stop_fiyat: this.aktif_stop, cikis_sinyali: cikis };
  }

  /** UI gösterimi için anlık durum. */
  durum(): TrailDurum {
    return {
      yon: this.yon,
      en_iyi_fiyat: this.en_iyi_fiyat,
      peak_kar_yuzde: this.en_yuksek_kar_yuzde,
      atr_carpan: this.son_atr_carpan,
      aktif_stop: this.aktif_stop,
      cikis: this.cikis_tetiklendi,
    };
  }

  /**
   * Persistence için snapshot (localStorage'a yazılır).
   * Panel'in `_saveTrails` ile aynı alan adlarını kullanır — geriye uyum.
   */
  toSnapshot(): TrailSnapshot {
    return {
      yon: this.yon,
      en_iyi_fiyat: this.en_iyi_fiyat,
      en_yuksek_kar_yuzde: this.en_yuksek_kar_yuzde,
      aktif_stop: this.aktif_stop,
      cikis_tetiklendi: this.cikis_tetiklendi,
      son_atr_carpan: this.son_atr_carpan,
    };
  }

  /**
   * Snapshot'tan instance yarat (panel'in `_loadTrails`'ı ile aynı semantik).
   * Eski paneldeki ug52_trails localStorage formatıyla uyumlu.
   */
  static fromSnapshot(snapshot: TrailSnapshot): KademeliTrailingStop {
    const inst = new KademeliTrailingStop(snapshot.yon);
    inst.en_iyi_fiyat = snapshot.en_iyi_fiyat;
    inst.en_yuksek_kar_yuzde = snapshot.en_yuksek_kar_yuzde ?? 0;
    inst.aktif_stop = snapshot.aktif_stop;
    inst.cikis_tetiklendi = !!snapshot.cikis_tetiklendi;
    inst.son_atr_carpan = snapshot.son_atr_carpan ?? 2.0;
    return inst;
  }
}
