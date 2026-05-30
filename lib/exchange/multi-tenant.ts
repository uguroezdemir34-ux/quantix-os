/**
 * MULTI-TENANT EXECUTION ENGINE — Çoklu Hesap Paralel Yürütüm Mimarisi.
 *
 * Mimari hedef:
 *   Tek bir strateji sinyali → N izole OKX sub-account'a eş zamanlı iletilir.
 *   Her hesap kendi sandbox'ında (bakiye, kaldıraç, risk kilitleri) bağımsız çalışır.
 *   Bir hesabın hatası/likidasyonu diğerlerini etkilemez.
 *
 * Temel katmanlar:
 *   1. TenantRegistry   — kimlik + sandbox kayıtları
 *   2. TenantSandbox    — her hesabın izole risk durumu
 *   3. TenantAdapterFactory — her hesap için bağımsız ExchangeAdapter (kendi rate limiter)
 *   4. MultiTenantExecutor.fanout() — Promise.allSettled paralel dağıtım döngüsü
 *
 * Güvenlik:
 *   - API kimlik bilgileri hiçbir zaman plain text tutulmaz — şifreli referans (ENC1: prefix)
 *   - Her sandbox bağımsız: tenant A'nın drawdown lock'u tenant B'yi kilitlemez
 *   - Her adapter kendi TokenBucketRateLimiter'ına sahip → rate limit izolasyonu
 *
 * Saf bölümler (I/O yok): TenantRegistry, sandbox mutations, preflight check.
 * I/O bölümleri: fanout() → adapter.openPosition() async çağrıları.
 */

import type { ExchangeAdapter, AdapterResult, TradeData } from "./types";
import type { OpenPositionInput } from "./types";
import type { Pair } from "@/lib/constants/pairs";
import type { ScoreResult } from "@/lib/score/orchestrator";
import { runPreflightChecks } from "@/lib/orchestrator/preflight";
import type {
  OrchestratorDecision,
  AccountStateSnapshot,
  OrchestrateInput,
} from "@/lib/orchestrator/types";
import type { DrawdownProtocol } from "@/lib/store/accountStore";
import type { ExposurePosition } from "@/lib/risk/exposure";
import type { OpenPositionSummary } from "@/lib/risk/correlation";

// ─── Tenant kimliği ───────────────────────────────────────────

export type TenantId = string;

// ─── Şifreli kimlik bilgileri ────────────────────────────────

/**
 * Tenant API kimlik bilgileri — hiçbir zaman plain-text saklanmaz.
 * encryptedApiKey / encryptedSecret / encryptedPassphrase:
 *   AES-256-GCM ile şifrelenmiş "ENC1:<base64>" formatında string.
 *   Çözme: lib/store/secure-storage.ts → decryptValue()
 */
export interface TenantCredentials {
  tenantId: TenantId;
  /** İnsan okunabilir etiket (display only) */
  label: string;
  /** Şifreli OKX API Key (ENC1: prefix) */
  encryptedApiKey: string;
  /** Şifreli OKX Secret Key */
  encryptedSecretKey: string;
  /** Şifreli OKX Passphrase */
  encryptedPassphrase: string;
  /** Demo mod mu? */
  isDemo: boolean;
}

// ─── Sandbox (izole risk durumu) ─────────────────────────────

/**
 * Her tenant'ın tamamen bağımsız risk durumu.
 * Bir tenant'ın sandbox'ı güncellenmesi diğerlerini etkilemez.
 */
export interface TenantSandbox {
  tenantId: TenantId;
  /** Hesap net değeri (USDT) — pozisyon açılırken exposure kontrolü için */
  equityUsd: number;
  /** Bu hesap için max kaldıraç */
  maxLeverage: number;
  /** Günlük max emir sayısı */
  maxTradesPerDay: number;
  /** Bugün açılan emir sayısı */
  todayTradeCount: number;
  /** Drawdown koruma durumu */
  drawdownProtocol: DrawdownProtocol;
  /** BTC cooldown bitiş zamanı (epoch ms, 0=aktif değil) */
  btcCooldownUntil: number;
  /** BTC self cooldown bitiş zamanı */
  btcSelfCooldownUntil: number;
  /** Açık pozisyonlar (korelasyon kontrolü için) */
  openPositions: OpenPositionSummary[];
  /** Açık pozisyonlar + margin (exposure kontrolü için) */
  openPositionsWithMargin: ExposurePosition[];
  /**
   * Bu tenant aktif mi?
   * false → fanout sırasında atlanır (skipped)
   */
  enabled: boolean;
  /**
   * Manuel kilitleme nedeni — admin müdahalesi veya likidason sonrası.
   * undefined = kilitli değil.
   */
  lockedReason?: string;
}

// ─── Tenant konfigürasyonu ───────────────────────────────────

export interface TenantConfig {
  credentials: TenantCredentials;
  sandbox: TenantSandbox;
}

// ─── Fanout sonucu ────────────────────────────────────────────

/** Tek bir tenant için yürütüm sonucu */
export interface TenantExecutionResult {
  tenantId: TenantId;
  label: string;
  ok: boolean;
  decision: OrchestratorDecision | "skipped_disabled" | "skipped_locked";
  reasonHuman: string;
  tradeResult?: AdapterResult<TradeData>;
  /** ms cinsinden yürütüm süresi */
  durationMs: number;
  /** Yürütüm sonrası sandbox durumu (snapshot) */
  sandboxAfter: Readonly<TenantSandbox>;
}

/** Tüm tenant'lara dağıtım sonucu */
export interface FanoutResult {
  /** Dağıtımı tetikleyen sinyal pair */
  pair: Pair;
  dispatchedAt: number;
  completedAt: number;
  results: TenantExecutionResult[];
  successCount: number;
  failureCount: number;
  skippedCount: number;
}

// ─── Adapter factory arayüzü ──────────────────────────────────

/**
 * Her tenant için bağımsız ExchangeAdapter oluşturan fabrika.
 * Gerçek impl: OkxAdapter (her tenant kendi rate limiter'ına sahip)
 * Test impl: mock adapter inject edilir
 */
export type TenantAdapterFactory = (
  tenantId: TenantId,
  credentials: TenantCredentials,
) => ExchangeAdapter;

// ─── Tenant Registry ─────────────────────────────────────────

/**
 * Tüm tenant konfigürasyonlarını ve sandbox durumlarını yönetir.
 * Sandbox mutasyonları burada merkezi — her fanout sonrası güncellenir.
 */
export class TenantRegistry {
  private tenants: Map<TenantId, TenantConfig> = new Map();

  /** Tenant kaydet */
  register(config: TenantConfig): void {
    this.tenants.set(config.credentials.tenantId, {
      credentials: { ...config.credentials },
      sandbox: { ...config.sandbox },
    });
  }

  /** Tenant sil */
  unregister(tenantId: TenantId): boolean {
    return this.tenants.delete(tenantId);
  }

  /** Tenant config al */
  get(tenantId: TenantId): TenantConfig | undefined {
    const entry = this.tenants.get(tenantId);
    if (!entry) return undefined;
    return {
      credentials: { ...entry.credentials },
      sandbox: { ...entry.sandbox },
    };
  }

  /** Tüm tenant'lar */
  getAll(): TenantConfig[] {
    return Array.from(this.tenants.values()).map((c) => ({
      credentials: { ...c.credentials },
      sandbox: { ...c.sandbox },
    }));
  }

  /** Aktif (enabled + kilitli olmayan) tenant'lar */
  getEnabled(): TenantConfig[] {
    return this.getAll().filter((c) => c.sandbox.enabled && !c.sandbox.lockedReason);
  }

  /** Sandbox güncelle */
  updateSandbox(tenantId: TenantId, updates: Partial<TenantSandbox>): boolean {
    const entry = this.tenants.get(tenantId);
    if (!entry) return false;
    entry.sandbox = { ...entry.sandbox, ...updates };
    return true;
  }

  /** Tenant'ı kilitle (likidason / admin müdahalesi) */
  lockTenant(tenantId: TenantId, reason: string): boolean {
    return this.updateSandbox(tenantId, { enabled: false, lockedReason: reason });
  }

  /** Tenant kilidini aç */
  unlockTenant(tenantId: TenantId): boolean {
    return this.updateSandbox(tenantId, { enabled: true, lockedReason: undefined });
  }

  /** Kayıtlı tenant sayısı */
  size(): number {
    return this.tenants.size;
  }
}

// ─── Sandbox → AccountStateSnapshot dönüşümü ─────────────────

function sandboxToAccountState(
  sandbox: TenantSandbox,
): AccountStateSnapshot {
  return {
    drawdownProtocol: sandbox.drawdownProtocol,
    btcCooldownUntil: sandbox.btcCooldownUntil,
    btcSelfCooldownUntil: sandbox.btcSelfCooldownUntil,
    todayTradeCount: sandbox.todayTradeCount,
    maxTradesPerDay: sandbox.maxTradesPerDay,
    openPositions:
      sandbox.openPositions.length > 0 ? sandbox.openPositions : undefined,
    openPositionsWithMargin:
      sandbox.openPositionsWithMargin.length > 0
        ? sandbox.openPositionsWithMargin
        : undefined,
    equityUsd: sandbox.equityUsd,
  };
}

// ─── Tek tenant yürütümü ─────────────────────────────────────

async function executeTenant(
  config: TenantConfig,
  signal: ScoreResult,
  pair: Pair,
  adapter: ExchangeAdapter,
  qty: number,
  livePrice: number,
  leverage: number,
  now: number,
): Promise<TenantExecutionResult> {
  const { credentials, sandbox } = config;
  const t0 = Date.now();

  const makeResult = (
    ok: boolean,
    decision: TenantExecutionResult["decision"],
    reasonHuman: string,
    tradeResult?: AdapterResult<TradeData>,
  ): TenantExecutionResult => ({
    tenantId: credentials.tenantId,
    label: credentials.label,
    ok,
    decision,
    reasonHuman,
    tradeResult,
    durationMs: Date.now() - t0,
    sandboxAfter: { ...sandbox },
  });

  // ── Sandbox kilidi kontrolü ──
  if (!sandbox.enabled || sandbox.lockedReason) {
    return makeResult(
      false,
      "skipped_locked",
      sandbox.lockedReason ?? "Tenant devre dışı",
    );
  }

  // ── Kaldıraç limiti kontrolü ──
  if (leverage > sandbox.maxLeverage) {
    return makeResult(
      false,
      "blocked_verdict",
      `Kaldıraç ${leverage}x > tenant limiti ${sandbox.maxLeverage}x`,
    );
  }

  // ── Preflight kontrolleri (sandbox içinde izole) ──
  const accountState = sandboxToAccountState(sandbox);
  const orchestrateInput: OrchestrateInput = {
    signal,
    pair,
    livePrice,
    qty,
    stopPrice: 0,
    leverage,
    marginMode: "isolated",
    source: "bot",
    accountState,
  };

  const preflight = runPreflightChecks(orchestrateInput, now);
  if (!preflight.passed) {
    return makeResult(false, preflight.decision, preflight.reasonHuman);
  }

  // ── Emir gönder ──
  const direction = signal.direction as "LONG" | "SHORT";
  const orderInput: OpenPositionInput = {
    pair,
    direction,
    qty,
    leverage,
    marginMode: "isolated",
  };

  let tradeResult: AdapterResult<TradeData>;
  try {
    tradeResult = await adapter.openPosition(orderInput);
  } catch (e) {
    tradeResult = {
      ok: false,
      errorKind: "EXCEPTION",
      errorMessage: e instanceof Error ? e.message : "Unknown error",
    };
  }

  if (!tradeResult.ok) {
    return makeResult(false, "failed_exchange", tradeResult.errorMessage ?? "Exchange error", tradeResult);
  }

  // ── Sandbox güncelle (emir başarılı) ──
  const updatedSandbox: TenantSandbox = {
    ...sandbox,
    todayTradeCount: sandbox.todayTradeCount + 1,
  };

  return {
    tenantId: credentials.tenantId,
    label: credentials.label,
    ok: true,
    decision: "executed",
    reasonHuman: "Emir başarıyla iletildi",
    tradeResult,
    durationMs: Date.now() - t0,
    sandboxAfter: { ...updatedSandbox },
  };
}

// ─── Multi-Tenant Executor ────────────────────────────────────

export interface MultiTenantExecutorOptions {
  /** Sinyal başına hedef qty (position sizer'dan gelir) */
  defaultQty: number;
  /** Canlı fiyat (skor engine'den) */
  defaultLivePrice: number;
  /** Kaldıraç (her tenant kendi limitini ayrıca kontrol eder) */
  defaultLeverage: number;
  /** Şu an (test inject) */
  now?: () => number;
}

/**
 * Multi-Tenant yürütüm motoru.
 *
 * fanout():
 *   1. Tüm enabled tenant'ları al
 *   2. Her biri için adapter oluştur (bağımsız rate limiter)
 *   3. Promise.allSettled ile paralel yürüt
 *   4. Sonuçları topla, sandbox'ları güncelle
 *   5. FanoutResult döndür
 */
export class MultiTenantExecutor {
  private readonly registry: TenantRegistry;
  private readonly adapterFactory: TenantAdapterFactory;
  private readonly opts: MultiTenantExecutorOptions;

  constructor(
    registry: TenantRegistry,
    adapterFactory: TenantAdapterFactory,
    opts: MultiTenantExecutorOptions,
  ) {
    this.registry = registry;
    this.adapterFactory = adapterFactory;
    this.opts = opts;
  }

  /**
   * Sinyali tüm aktif tenant'lara paralel dağıt.
   *
   * Her tenant kendi sandbox'ında bağımsız çalışır.
   * Bir tenant başarısız olsa bile diğerleri tamamlanır (Promise.allSettled).
   */
  async fanout(
    signal: ScoreResult,
    pair: Pair,
    overrides?: Partial<MultiTenantExecutorOptions>,
  ): Promise<FanoutResult> {
    const now = (overrides?.now ?? this.opts.now ?? (() => Date.now()))();
    const qty = overrides?.defaultQty ?? this.opts.defaultQty;
    const livePrice = overrides?.defaultLivePrice ?? this.opts.defaultLivePrice;
    const leverage = overrides?.defaultLeverage ?? this.opts.defaultLeverage;
    const dispatchedAt = now;

    // Aktif tenant'ları al
    const enabled = this.registry.getEnabled();

    // Her tenant için adapter oluştur ve paralel yürüt
    const tasks = enabled.map((config) => {
      const adapter = this.adapterFactory(config.credentials.tenantId, config.credentials);
      return executeTenant(config, signal, pair, adapter, qty, livePrice, leverage, now);
    });

    // Promise.allSettled → bir tenant çökmesi diğerlerini etkilemez
    const settled = await Promise.allSettled(tasks);

    const results: TenantExecutionResult[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        const r = outcome.value;
        results.push(r);
        // Sandbox'ı güncelle (başarılı yürütüm sonrası)
        if (r.ok) {
          this.registry.updateSandbox(r.tenantId, {
            todayTradeCount: r.sandboxAfter.todayTradeCount,
          });
        }
        // Adapter exception ile sonuçlanan tenant'ı kilitle (koruyucu)
      } else {
        // Bu branch aslında olmamalı (executeTenant try/catch içeriyor)
        // Ama Promise.allSettled rejected olursa diye fallback
        results.push({
          tenantId: "unknown",
          label: "unknown",
          ok: false,
          decision: "failed_exchange",
          reasonHuman: outcome.reason instanceof Error
            ? outcome.reason.message
            : "Beklenmeyen hata",
          durationMs: 0,
          sandboxAfter: {
            tenantId: "unknown",
            equityUsd: 0,
            maxLeverage: 1,
            maxTradesPerDay: 0,
            todayTradeCount: 0,
            drawdownProtocol: { tier: "locked", multiplier: 0, label: "Error" },
            btcCooldownUntil: 0,
            btcSelfCooldownUntil: 0,
            openPositions: [],
            openPositionsWithMargin: [],
            enabled: false,
            lockedReason: "Exception during execution",
          },
        });
      }
    }

    // Devre dışı (not enabled) tenant'lar için skipped sonuç ekle
    const allTenants = this.registry.getAll();
    for (const config of allTenants) {
      const alreadyInResults = results.some(
        (r) => r.tenantId === config.credentials.tenantId,
      );
      if (!alreadyInResults) {
        results.push({
          tenantId: config.credentials.tenantId,
          label: config.credentials.label,
          ok: false,
          decision: "skipped_disabled",
          reasonHuman: config.sandbox.lockedReason ?? "Tenant devre dışı",
          durationMs: 0,
          sandboxAfter: { ...config.sandbox },
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    const skippedCount = results.filter(
      (r) => r.decision === "skipped_disabled" || r.decision === "skipped_locked",
    ).length;
    const failureCount = results.length - successCount - skippedCount;

    return {
      pair,
      dispatchedAt,
      completedAt: Date.now(),
      results,
      successCount,
      failureCount,
      skippedCount,
    };
  }

  /** Registry'e erişim (test / admin için) */
  getRegistry(): TenantRegistry {
    return this.registry;
  }
}

// ─── Yardımcı fabrikalar ─────────────────────────────────────

/**
 * Minimal sandbox oluştur — yeni tenant kayıt için.
 */
export function createDefaultSandbox(
  tenantId: TenantId,
  equityUsd: number,
  maxLeverage = 10,
  maxTradesPerDay = 2,
): TenantSandbox {
  return {
    tenantId,
    equityUsd,
    maxLeverage,
    maxTradesPerDay,
    todayTradeCount: 0,
    drawdownProtocol: {
      tier: "normal",
      multiplier: 1,
      label: "Normal",
    },
    btcCooldownUntil: 0,
    btcSelfCooldownUntil: 0,
    openPositions: [],
    openPositionsWithMargin: [],
    enabled: true,
  };
}

/**
 * Minimal TenantCredentials oluştur (şifreli anahtar placeholder ile).
 * Gerçek implementasyonda encryptedApiKey ENC1: formatında olmalı.
 */
export function createTenantCredentials(
  tenantId: TenantId,
  label: string,
  encryptedApiKey: string,
  encryptedSecretKey: string,
  encryptedPassphrase: string,
  isDemo = true,
): TenantCredentials {
  return {
    tenantId,
    label,
    encryptedApiKey,
    encryptedSecretKey,
    encryptedPassphrase,
    isDemo,
  };
}
