"use client";

import { useState, useMemo } from "react";
import { useScoreStore } from "@/lib/store/scoreStore";
import { useCandleStore, EMPTY_CANDLES } from "@/lib/store/candleStore";
import { useMarketStore } from "@/lib/store/marketStore";
import { useAccountStore } from "@/lib/store/accountStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useRiskStore } from "@/lib/store/riskStore";
import { useTradesStore } from "@/lib/store/tradesStore";
import { useMacroStore } from "@/lib/store/macroStore";
import { PAIRS, type Pair } from "@/lib/constants/pairs";
import { VerdictBadge } from "@/components/karar/VerdictBadge";
import { ScoreBar } from "@/components/karar/ScoreBar";
import { ScoreBreakdown } from "@/components/karar/ScoreBreakdown";
import { BlocksList } from "@/components/karar/BlocksList";
import { ReasonsList } from "@/components/karar/ReasonsList";
import { DirectionBadge } from "@/components/karar/DirectionBadge";
import { FlowAlignmentRow } from "@/components/karar/FlowAlignmentRow";
import { PositionSizer } from "@/components/karar/PositionSizer";
import { TradeConfirmModal } from "@/components/karar/TradeConfirmModal";
import { computePositionSize } from "@/lib/sizer/position";
import { atr } from "@/lib/indicators/atr";
import { adx } from "@/lib/indicators/adx";
import { toIndicatorCandle } from "@/lib/okx/candles";
import { findSwingLevels } from "@/lib/sr/swing";
import { orchestrate } from "@/lib/orchestrator/router";
import { getOkxAdapter } from "@/lib/exchange/okx-adapter";
import { createChannel } from "@/lib/notify/registry";
import { getGlobalDedupeStore } from "@/lib/orchestrator/dedupe";
import type { PositionSizerResult } from "@/lib/sizer/types";
import { useFlowIntelligence } from "@/lib/hooks/useFlowIntelligence";
import { getBucketStats } from "@/lib/bucket/stats";

export default function KararPage() {
  const [activePair, setActivePair] = useState<Pair>("BTC");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);

  const result = useScoreStore((s) => s.results[activePair]);
  const computing = useScoreStore((s) => s.computing);
  const candles1hRaw = useCandleStore((s) => s.candles[`${activePair}_1h`]);
  const candles4hRaw = useCandleStore((s) => s.candles[`${activePair}_4h`]);
  const candles1h = candles1hRaw ?? EMPTY_CANDLES;
  const candles4h = candles4hRaw ?? EMPTY_CANDLES;
  const livePrice = useMarketStore((s) => s.prices[activePair]?.last ?? null);
  const balanceTotal = useAccountStore((s) => s.balanceTotal);
  const balanceFree = useAccountStore((s) => s.balanceFree);
  const drawdownProtocol = useAccountStore((s) => s.drawdownProtocol);
  const maxTradesPerDay = useSettingsStore((s) => s.maxTradesPerDay);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const btcCooldownUntil = useRiskStore((s) => s.btcCooldownUntil);
  const btcSelfCooldownUntil = useRiskStore((s) => s.btcSelfCooldownUntil);
  const logEvent = useRiskStore((s) => s.logEvent);
  const trades = useTradesStore((s) => s.trades);
  const openPending = useTradesStore((s) => s.openPending);
  const fundingBtc = useMacroStore((s) => s.fundingBtc);
  const fundingEth = useMacroStore((s) => s.fundingEth);
  const fgValue = useMacroStore((s) => s.fgValue);

  // Bucket istatistikleri — geçmiş trade'lerden score bazlı performans
  const bucketStats = useMemo(() => {
    if (!result) return null;
    const closedTrades = trades
      .filter((t) => t.status === "closed" && t.exit != null && t.pair === activePair)
      .map((t) => ({ score: t.entryContext.score, pnlUsd: t.exit!.pnlUsd }));
    return getBucketStats(result.score, closedTrades);
  }, [result, trades, activePair]);

  // Signal direction for flow intelligence (uppercase: "LONG" | "SHORT")
  const signalDir: "LONG" | "SHORT" =
    result?.direction === "SHORT" ? "SHORT" : "LONG";

  const flowResult = useFlowIntelligence(activePair, signalDir);

  const atrValue = useMemo(() => {
    if (candles1h.length < 15) return null;
    return atr(candles1h.map(toIndicatorCandle), { period: 14 });
  }, [candles1h]);

  // ADX ham değeri — TP modunu belirlemek için (weak/healthy/strong)
  const adxValue = useMemo(() => {
    if (candles1h.length < 29) return null;
    return adx(candles1h.map(toIndicatorCandle), 14)?.adx ?? null;
  }, [candles1h]);

  // Swing seviyeleri — yapısal stop için
  // 4h öncelikli (daha anlamlı yapı), 1h fallback
  const swingLevels = useMemo(() => {
    const sw4h =
      candles4h.length >= 10
        ? findSwingLevels(candles4h.map(toIndicatorCandle), 20, 2)
        : { swingLow: null, swingHigh: null };
    const sw1h =
      candles1h.length >= 10
        ? findSwingLevels(candles1h.map(toIndicatorCandle), 30, 2)
        : { swingLow: null, swingHigh: null };
    // 4h varsa kullan, yoksa 1h'a düş
    return {
      swingLow: sw4h.swingLow ?? sw1h.swingLow,
      swingHigh: sw4h.swingHigh ?? sw1h.swingHigh,
    };
  }, [candles1h, candles4h]);

  const sizerResult = useMemo<PositionSizerResult | null>(() => {
    if (!result || result.verdict !== "go") return null;
    if (!livePrice || !atrValue) return null;
    if (result.direction !== "LONG" && result.direction !== "SHORT") return null;

    return computePositionSize({
      pair: activePair,
      direction: result.direction,
      px: livePrice,
      atr: atrValue,
      adx1h: adxValue,
      swingLow: swingLevels.swingLow,
      swingHigh: swingLevels.swingHigh,
      balance: {
        total: balanceTotal,
        free: balanceFree,
      },
      drawdownProtocol: {
        tier: drawdownProtocol.tier,
        multiplier: drawdownProtocol.multiplier,
        label: drawdownProtocol.label,
      },
      bucket: bucketStats ?? {
        n: 0,
        wr: null,
        isCut: false,
        isBoost: false,
        hasData: false,
        min: 0,
        max: 0,
      },
      score: result.score,
    });
  }, [result, livePrice, atrValue, adxValue, swingLevels, activePair, balanceTotal, balanceFree, drawdownProtocol]);

  async function handleConfirm() {
    if (!sizerResult || !result || !livePrice) return;
    if (result.direction !== "LONG" && result.direction !== "SHORT") return;

    setIsExecuting(true);
    setExecError(null);

    const today = new Date();
    const todayTrades = trades.filter((t) => {
      const d = new Date(t.openedAt);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    });

    const fundingResult =
      activePair === "BTC" ? fundingBtc : fundingEth;

    try {
      const output = await orchestrate(
        {
          signal: result,
          pair: activePair,
          livePrice,
          qty: sizerResult.qty,
          stopPrice: sizerResult.stop.stopPrice,
          takeProfitPrice: sizerResult.tp.tp1Price,
          leverage: sizerResult.leverage,
          marginMode: "cross",
          source: "manual",
          accountState: {
            drawdownProtocol,
            btcCooldownUntil,
            btcSelfCooldownUntil,
            todayTradeCount: todayTrades.length,
            maxTradesPerDay,
          },
        },
        {
          adapter: getOkxAdapter(demoMode),
          channels: [createChannel("telegram")],
          dedupeStore: getGlobalDedupeStore(),
        },
      );

      // Disiplin logu — her durumda kayıt
      const je = output.journalEntry;
      logEvent(je.type as Parameters<typeof logEvent>[0], {
        pair: je.pair,
        direction: je.direction,
        score: je.score,
        decision: je.decision,
        source: je.source,
        reason: je.reason,
      });

      if (output.ok) {
        openPending({
          pair: activePair,
          direction: result.direction,
          entryPrice: livePrice,
          qty: sizerResult.qty,
          leverage: sizerResult.leverage,
          stopPrice: sizerResult.stop.stopPrice,
          takeProfit1: sizerResult.tp.tp1Price,
          takeProfit2: sizerResult.tp.tp2Price,
          riskAmountUsd: sizerResult.risk.riskUsd,
          isPaper: settings.demoMode,
          entryContext: {
            score: result.score,
            verdict: result.verdict,
            fgValue: fgValue ?? undefined,
            fundingRate: fundingResult?.fundingRate ?? undefined,
            drawdownTier: drawdownProtocol.tier,
          },
          orderId: output.tradeResult?.data?.orderId,
        });
        setShowConfirm(false);
      } else {
        setExecError(output.reasonHuman);
      }
    } catch (e) {
      setExecError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Pair seçici */}
      <div className="flex gap-2">
        {PAIRS.map((p) => (
          <button
            key={p}
            onClick={() => setActivePair(p)}
            className={`flex-1 rounded-md py-2 font-mono text-sm font-semibold tracking-wider transition-colors ${
              activePair === p
                ? "bg-surface-s2 text-text-t1"
                : "text-text-t3 hover:text-text-t2"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Yükleniyor */}
      {!result && (
        <div className="bg-surface-s1 rounded-lg p-6 text-center font-mono text-sm text-text-t3">
          {computing ? "Hesaplanıyor..." : "Mum verisi bekleniyor..."}
        </div>
      )}

      {/* Sonuç */}
      {result && (
        <>
          <VerdictBadge
            verdict={result.verdict}
            signalType={result.pullbackActive ? "pullback" : "classic"}
          />
          <DirectionBadge
            direction={result.direction}
            confidence={result.dirConfidence}
          />
          <ScoreBar
            score={result.score}
            threshold={result.effectiveThreshold}
            goThreshold={result.goThreshold}
          />
          <FlowAlignmentRow flow={flowResult} />
          <ScoreBreakdown sub={result.sub} reasons={result.reasons} />
          <BlocksList
            hardBlocks={result.blocks}
            softBlocks={result.softBlocks}
          />
          <ReasonsList reasons={result.reasons} />

          {sizerResult && (
            <PositionSizer
              result={sizerResult}
              onTrade={() => {
                setExecError(null);
                setShowConfirm(true);
              }}
            />
          )}

          {execError && (
            <div className="bg-soft-red text-signal-red rounded-lg p-3 font-mono text-xs">
              {execError}
            </div>
          )}
        </>
      )}

      {showConfirm && sizerResult && (
        <TradeConfirmModal
          result={sizerResult}
          onClose={() => setShowConfirm(false)}
          onConfirm={handleConfirm}
        />
      )}

      {isExecuting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-bg-card rounded-lg p-6 font-mono text-sm text-text-t1">
            Emir gönderiliyor...
          </div>
        </div>
      )}
    </div>
  );
}
