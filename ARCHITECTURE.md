# QUANTIX — Mimari Belgesi

> **Versiyon:** 1.0 (Faz 2 paket #7c)
> **Amaç:** Bu belge, QUANTIX panelinin **çoklu borsa + çoklu kanal** mimarisini tanımlar. Kod yazmadan önce okunmalı, kod yazıldıkça güncellenmeli.

---

## 1. Vizyon Özeti

**QUANTIX** üç ayağı olan bir trading sistemidir:

| Ayak | Açıklama | Gelir modeli |
|------|----------|--------------|
| **Disiplin Aracı (kendi kullanım)** | Sinyal motoru + risk + lock + adherence | Yok (kişisel) |
| **Telegram VIP** | Sinyal anında üyelere mesaj | Sabit abonelik ($X/ay) |
| **Borsa Copy Trading** | Master trader hesabı (OKX/Bybit) | Profit share (%10 OKX std.) |

**Düşük risk yaklaşım:** Sermaye tutulmuyor, regülasyon gerekmiyor, ölçek otomatik.

---

## 2. Katman Mimarisi

```
┌──────────────────────────────┐
│   1. SIGNAL ENGINE  ✓ HAZIR  │  Mum → İndikatör → Skor → Verdict
└──────────┬───────────────────┘
           │ ScoreResult
           ▼
┌──────────────────────────────┐
│   2. ORCHESTRATOR  ❌ YENİ   │  Karar router + idempotency + transaction
└──────────┬───────────────────┘
           │ SignalOrder
           ▼
   ┌───────┼───────┐
   ▼       ▼       ▼
┌──────┐┌──────┐┌──────────┐
│ 3a   ││ 3b   ││ 3c       │
│ EXEC ││ NTFY ││ JOURNAL  │
│      ││      ││ (log)    │
└──┬───┘└──┬───┘└────┬─────┘
   ▼       ▼         ▼
  OKX ✓  Telegram  DisciplineLog ✓
  BIN .  Discord . TradeSnapshot ❌
  BYB .  Email .   PostMortem ❌
```

### Bağlanma kuralları

**KURAL 1 — Yukarı bağımlılık yasak:** Signal Engine Orchestrator'u bilmez.
**KURAL 2 — Pure function tercih:** Mümkün olduğunda saf, I/O izole.
**KURAL 3 — Her dış sistem mock'lanabilir:** fetch override edilir.

---

## 3. Signal Engine (1.) — ✓ HAZIR

Faz 1b'de tamamlandı. Pure function. Aynı input → aynı output.

`composeScoreInput(...)` → `ScoreResult`

---

## 4. Orchestrator (2.) — ❌ Paket #8.5

### Sorumluluklar

1. Fan-out (Execution + Notify + Journal paralel)
2. Idempotency (1 sinyal = 1 trade, 30sn dedupe)
3. Pre-flight (drawdown, lock, daily limit)
4. Transaction (execution fail → notify YOK)
5. Audit log

### Sıralama (KRİTİK)

```
1. Pre-flight checks
2. Dedupe (son 30sn aynı sinyal var mı?)
3. EXECUTION ÖNCE — fail → return
4. NOTIFY SONRA — execution confirmed olduğu için
5. JOURNAL — her durumda
```

**Neden bu sıra:** Notify önce gitse + execution fail olsa, **Telegram VIP üyeleri yanlış emirle para kaybeder, sen mesaj çekersin**. Etik + yasal risk.

---

## 5. Execution Adapters (3a.) — ❌ Paket #8

### Interface

```typescript
interface ExchangeAdapter {
  readonly name: 'okx' | 'binance' | 'bybit';
  ping(): Promise<{ ok: boolean; latencyMs: number }>;
  getBalance(): Promise<{ totalUsdt: number; freeUsdt: number }>;
  getPositions(): Promise<Position[]>;
  openPosition(input: OpenPositionInput): Promise<TradeResult>;
  closePosition(input: ClosePositionInput): Promise<TradeResult>;
  setProtection(input: SetProtectionInput): Promise<TradeResult>;
}
```

### Borsa farkları (interface bunları absorb eder)

| Özellik | OKX | Binance | Bybit |
|---------|-----|---------|-------|
| Symbol format | `BTC-USDT-SWAP` | `BTCUSDT` | `BTCUSDT` |
| Position unit | coin (BTC=0.001) | contracts | coin |
| Position mode | net/hedge | one-way/hedge | one-way/hedge |
| Funding endpoint | farklı | farklı | farklı |
| Copy trading API | ✓ | ✗ | ✓ |
| Demo mode | header | ayrı domain | ayrı domain |

### Klasör yapısı

```
lib/exchange/
├── types.ts              # ExchangeAdapter interface
├── registry.ts           # createAdapter('okx') factory
├── okx/adapter.ts        # ✓ dolu (mevcut lib/okx/ taşınır)
├── binance/adapter.ts    # iskelet (throw NOT_IMPLEMENTED)
└── bybit/adapter.ts      # iskelet
```

### Boş iskelet stratejisi

Binance/Bybit adapter'ları interface'i implement eder ama `throw new Error('NOT_IMPLEMENTED')` döner. TypeScript zorlar: ana kod tüm borsaları **muamele etmek zorunda**, unutamaz.

---

## 6. Notify Channels (3b.) — ❌ Paket #9

### Interface

```typescript
interface NotifyChannel {
  readonly name: 'telegram' | 'discord' | 'email';
  send(msg: NotifyMessage): Promise<NotifyResult>;
  isConfigured(): boolean;
}
```

### Telegram

**Config (.env.local):**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_VIP_CHAT_ID`

**Mesaj formatı:**

```
🚨 QUANTIX SİNYALİ

▲ BTC LONG @ $77,220
🛑 Stop: $76,800 (-0.54%)
🎯 TP1: $77,800 (+0.75%)
🎯 TP2: $78,400 (+1.53%)

📊 Skor: 87/100
💡 Sebep: ADX güçlü, regime trend, sweep yok
⏰ 21:45 UTC

#BTC #LONG
```

---

## 7. Journal (3c.)

- ✓ `DisciplineLog` mevcut
- ❌ `TradeSnapshot` (paket #14): market state JSON capture
- ❌ `PostMortem` (sonra): stop sonrası rule-based analiz

---

## 8. UI/Artifact (4.)

UI alt katmanlara dokunmaz, hep store/hook üzerinden.

---

## 9. Config & Environment

**.env.local:**

```bash
# OKX prod
OKX_API_KEY=
OKX_API_SECRET=
OKX_API_PASSPHRASE=

# OKX demo
OKX_DEMO_API_KEY=
OKX_DEMO_API_SECRET=
OKX_DEMO_API_PASSPHRASE=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_VIP_CHAT_ID=

# Gelecek (boş)
BINANCE_API_KEY=
BYBIT_API_KEY=
DISCORD_WEBHOOK_URL=
```

---

## 10. Çoklu Borsa Stratejisi

### Şimdi (tek-borsa OKX)

```
Uğur OKX emir → copy trading takipçileri tetiklenir
              → Telegram VIP mesaj alır → manuel emir verir
```

### 6+ ay sonra (çoklu-borsa)

```
Uğur sinyal → Orchestrator
            ├→ OKX master (copy)
            ├→ Bybit master (copy)
            └→ Binance master (manuel)
            → Telegram VIP mesaj
```

**Risk:** Borsalar arası fiyat farkı ~0.05% (normal).
**Karar:** Çoklu-borsa opsiyonel, config'den kapatılabilir. Default kapalı.

---

## 11. Test Stratejisi

| Katman | Test türü |
|--------|-----------|
| Signal Engine | Pure unit |
| Orchestrator | Integration (mock adapter + channel) |
| Adapter | Unit (fetch mock) |
| Channel | Unit (fetch mock) |
| Journal | Unit (localStorage mock) |
| UI | Component (renderWithI18n) |

**Hedef test (vizyon tamam):** ~1800

---

## 12. Güvenlik

1. API key'ler **asla** client bundle'ında — sadece API route server-side
2. HMAC imzalama server-side
3. `.env.local` `.gitignore`'da
4. Adapter katmanında rate limiting
5. Her emir DisciplineLog'a yazılır (audit)

---

## 13. Roadmap

| Paket | İçerik | Süre |
|-------|--------|------|
| #7c (bu) | ARCHITECTURE.md | 1h |
| #8 | Exchange Adapter | 5-7h |
| #8.5 | Orchestrator | 3-4h |
| #9 | Telegram Notify | 3-4h |
| #10 | P&L Sekmesi | 4-5h |
| #11 | Piyasa Sekmesi | 4h |
| #12 | Grafik Sekmesi | 5h |
| #13 | Ayarlar genişleme | 3h |
| #14 | Trade Snapshot | 3h |
| #15 | QUANTIX Rebrand | 2h |
| Faz 3 #16-18 | Doğrulama + deploy | 8h |
| **6+ ay** | Binance/Bybit dolumu | - |
| **6+ ay** | Post-mortem rule-based | - |
| **12+ ay** | Pattern detection | - |
| **18+ ay** | Tweet engine | - |

---

## 14. Karar Geçmişi

| Tarih | Karar | Gerekçe |
|-------|-------|---------|
| 2026-05-21 | "Self-learning AI yok" | Veri yok, istatistiksel pattern yeter |
| 2026-05-21 | Multi-exchange ready, OKX dolu | Şimdi gereksiz iş, sonra refactor pahalı |
| 2026-05-21 | Telegram VIP + Copy Trading | Regülasyon riski yok |
| 2026-05-21 | Execution ÖNCE, Notify SONRA | Etik: takipçi para kaybetmesin |
| 2026-05-21 | QUANTIX rebrand paket #15'e | Önce çekirdek, sonra marka |

---

**Son güncelleme:** Paket #7c (mimari belge)
**Sıradaki:** Paket #8 — Exchange Adapter Pattern
