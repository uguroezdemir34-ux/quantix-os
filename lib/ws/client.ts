/**
 * WS CLIENT — Real-time market data client.
 * Kaynak: panel_v55_51.html satır 6075-6225 (initWS + onmessage + reconnect).
 *
 * Sorumluluklar:
 *   - WS bağlantı yönetimi (connect, reconnect, destroy)
 *   - URL rotasyonu (OKX → Binance fallback)
 *   - Silence watchdog (5s tick yoksa "silent" → reconnect)
 *   - OKX ping (25s)
 *   - Mesaj parse + event emit
 *   - **NO STORE COUPLING**: client store'u bilmez. Event listener tarafı
 *     (hook) tick'leri store'a iter.
 *
 * Test edilebilirlik:
 *   - `WebSocket` constructor inject edilebilir → mock WS testlerde
 *   - `now()` saat fonksiyonu inject edilebilir → deterministik test
 *   - `setTimeout/setInterval` opsiyonel olarak inject edilebilir
 */

import type {
  Tick,
  ConnectionState,
  WsEndpoint,
} from "./types";
import { WS_CONSTANTS } from "./types";
import { parseAnyMessage } from "./messages";
import { getFirstEndpoint, getNextEndpoint } from "./urls";
import { getReconnectDelay } from "./backoff";
import type { Pair } from "@/lib/constants/pairs";
import type { OkxTradeRaw } from "@/lib/orderflow/types";

type TickListener = (tick: Tick) => void;
type StatusListener = (state: ConnectionState) => void;
type TradeRawListener = (pair: Pair, raws: OkxTradeRaw[]) => void;

/** WebSocket abstraction (test mock'u için) */
export interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

/** WS factory (real veya mock) */
export type WsFactory = (url: string) => WsLike;

/** Timer abstraction (test'te fake timers) */
export interface TimerFns {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
}

/** Default timer fns (production) */
const defaultTimerFns: TimerFns = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

/** Default WS factory (production) */
const defaultWsFactory: WsFactory = (url) =>
  new WebSocket(url) as unknown as WsLike;

export interface OkxWsClientOptions {
  /** WS constructor (test mock'u için) */
  wsFactory?: WsFactory;
  /** Timer + saat fonksiyonları (test için) */
  timers?: TimerFns;
  /** Otomatik connect (default true) */
  autoConnect?: boolean;
}

export class OkxWsClient {
  private wsFactory: WsFactory;
  private timers: TimerFns;
  private ws: WsLike | null = null;
  private state: ConnectionState;
  private currentEndpointIdx: number = -1;
  private currentEndpoint: WsEndpoint | null = null;
  private pingTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private silenceCheckTimer: unknown = null;
  private destroyed: boolean = false;
  // Open24h cache (trade mesajlarında chg hesabı için)
  private open24hByPair: Partial<Record<Pair, number>> = {};
  // Listener'lar
  private tickListeners = new Set<TickListener>();
  private statusListeners = new Set<StatusListener>();
  private tradeRawListeners = new Set<TradeRawListener>();

  constructor(opts: OkxWsClientOptions = {}) {
    this.wsFactory = opts.wsFactory ?? defaultWsFactory;
    this.timers = opts.timers ?? defaultTimerFns;
    this.state = {
      status: "idle",
      currentUrl: null,
      currentType: null,
      retries: 0,
      lastTickAt: 0,
      connectedAt: null,
    };
    if (opts.autoConnect !== false) {
      // Slight delay so listeners can attach
      this.timers.setTimeout(() => this.connect(), 0);
    }
  }

  // ═══════════════ PUBLIC API ═══════════════

  /** Tick event listener ekle, unsubscribe fn döner */
  onTick(cb: TickListener): () => void {
    this.tickListeners.add(cb);
    return () => this.tickListeners.delete(cb);
  }

  /** Raw OKX trade batch listener (order flow için). */
  onTradeRaw(cb: TradeRawListener): () => void {
    this.tradeRawListeners.add(cb);
    return () => this.tradeRawListeners.delete(cb);
  }

  /** Status event listener ekle */
  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    // Mevcut state'i hemen ver
    cb(this.state);
    return () => this.statusListeners.delete(cb);
  }

  /** Mevcut bağlantı durumu */
  getState(): ConnectionState {
    return { ...this.state };
  }

  /** Manuel bağlan (autoConnect=false ile başlatıldıysa) */
  connect(): void {
    if (this.destroyed) return;
    this.cleanupSocket();
    // İlk denemede ilk endpoint, sonraki denemelerde rotation
    const next =
      this.currentEndpointIdx < 0
        ? getFirstEndpoint()
        : getNextEndpoint(this.currentEndpointIdx);
    this.currentEndpoint = next.endpoint;
    this.currentEndpointIdx = next.idx;
    this.updateState({
      status: "connecting",
      currentUrl: next.endpoint.url,
      currentType: next.endpoint.type,
    });

    try {
      const ws = this.wsFactory(next.endpoint.url);
      this.ws = ws;
      ws.onopen = () => this.handleOpen();
      ws.onmessage = (ev) => this.handleMessage(ev.data);
      ws.onerror = () => this.handleError();
      ws.onclose = () => this.handleClose();
    } catch {
      this.scheduleReconnect();
    }
  }

  /** Bağlantıyı kapat ve auto-reconnect'i durdur (manuel kapatma) */
  destroy(): void {
    this.destroyed = true;
    this.cleanupSocket();
    this.cancelReconnect();
    this.updateState({ status: "destroyed" });
    this.tickListeners.clear();
    this.statusListeners.clear();
    this.tradeRawListeners.clear();
  }

  /** Mevcut bağlantıyı kapat (reconnect tetiklenir) */
  reconnect(): void {
    if (this.destroyed) return;
    this.cleanupSocket();
    this.scheduleReconnect();
  }

  // ═══════════════ INTERNAL ═══════════════

  private handleOpen(): void {
    if (!this.currentEndpoint) return;
    const now = this.timers.now();
    this.updateState({
      status: "connected",
      retries: 0, // Başarılı bağlantı → retry count sıfırla
      connectedAt: now,
      lastTickAt: now, // İlk tick zamanı = open zamanı (silence watchdog başlangıç)
    });

    // OKX subscribe + ping
    if (this.currentEndpoint.type === "okx") {
      if (this.currentEndpoint.subscribeMessage && this.ws) {
        try {
          this.ws.send(JSON.stringify(this.currentEndpoint.subscribeMessage));
        } catch {
          // ignored
        }
      }
      this.pingTimer = this.timers.setInterval(() => {
        if (this.ws && this.ws.readyState === 1) {
          try {
            this.ws.send("ping");
          } catch {
            // ignored
          }
        }
      }, WS_CONSTANTS.OKX_PING_INTERVAL_MS);
    }

    // Silence watchdog — periyodik kontrol et
    this.silenceCheckTimer = this.timers.setInterval(() => {
      this.checkSilence();
    }, WS_CONSTANTS.SILENCE_CHECK_MS);
  }

  private handleMessage(data: string): void {
    if (data === "pong") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Bozuk JSON
    }

    // Order flow: OKX trades channel → raw emit (side + sz dahil)
    if (this.tradeRawListeners.size > 0) {
      this.tryEmitTradeRaw(parsed);
    }

    const ticks = parseAnyMessage(parsed, this.timers.now(), this.open24hByPair);
    if (!ticks) return;

    for (const tick of ticks) {
      // open24h cache güncelle (trade için chg hesabında kullanılır)
      if (tick.source === "ticker") {
        this.open24hByPair[tick.pair] = tick.open24h;
      }
      this.emitTick(tick);
    }

    // Tick alındı → silence durumundan çık
    if (ticks.length > 0) {
      const now = this.timers.now();
      this.state.lastTickAt = now;
      if (this.state.status === "silent") {
        this.updateState({ status: "connected" });
      }
    }
  }

  private handleError(): void {
    // onclose genelde hemen takip eder, ekstra bir şey yapmıyoruz
  }

  private handleClose(): void {
    if (this.destroyed) return;
    this.updateState({ status: "disconnected" });
    this.cleanupTimers();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.cancelReconnect();
    const newRetries = this.state.retries + 1;
    this.state.retries = newRetries;
    const delay = getReconnectDelay(newRetries);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Silence watchdog kontrolü */
  private checkSilence(): void {
    if (this.state.status !== "connected" && this.state.status !== "silent") return;
    const now = this.timers.now();
    const tickAge = now - this.state.lastTickAt;
    if (tickAge >= WS_CONSTANTS.SILENCE_TIMEOUT_MS) {
      if (this.state.status === "connected") {
        // İlk silence: status'u güncelle ama hemen kapatma
        this.updateState({ status: "silent" });
        return;
      }
      // Hala silent — bağlantıyı kapat, reconnect tetiklenir
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignored
        }
      }
    }
  }

  private cleanupSocket(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        if (this.ws.readyState === 0 || this.ws.readyState === 1) {
          this.ws.close();
        }
      } catch {
        // ignored
      }
      this.ws = null;
    }
    this.cleanupTimers();
  }

  private cleanupTimers(): void {
    if (this.pingTimer) {
      this.timers.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.silenceCheckTimer) {
      this.timers.clearInterval(this.silenceCheckTimer);
      this.silenceCheckTimer = null;
    }
  }

  private updateState(partial: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...partial };
    for (const cb of this.statusListeners) cb(this.state);
  }

  private tryEmitTradeRaw(parsed: unknown): void {
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("arg" in parsed) ||
      !("data" in parsed)
    ) return;
    const p = parsed as { arg?: { channel?: string; instId?: string }; data?: unknown[] };
    if (p.arg?.channel !== "trades") return;
    const instId = p.arg?.instId ?? "";
    // instId → pair (BTC-USDT-SWAP → BTC, ETH-USDT-SWAP → ETH)
    const pair: Pair | null = instId.startsWith("BTC")
      ? "BTC"
      : instId.startsWith("ETH")
      ? "ETH"
      : null;
    if (!pair || !Array.isArray(p.data)) return;
    const raws: OkxTradeRaw[] = [];
    for (const item of p.data) {
      if (
        item &&
        typeof item === "object" &&
        "px" in item &&
        "sz" in item &&
        "side" in item &&
        "tradeId" in item &&
        "ts" in item
      ) {
        raws.push({
          instId,
          px: String((item as Record<string, unknown>).px),
          sz: String((item as Record<string, unknown>).sz),
          side: (item as Record<string, unknown>).side as "buy" | "sell",
          tradeId: String((item as Record<string, unknown>).tradeId),
          ts: String((item as Record<string, unknown>).ts),
        });
      }
    }
    if (raws.length === 0) return;
    for (const cb of this.tradeRawListeners) cb(pair, raws);
  }

  private emitTick(tick: Tick): void {
    for (const cb of this.tickListeners) cb(tick);
  }
}
