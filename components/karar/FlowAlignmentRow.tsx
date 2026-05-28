"use client";

/**
 * FLOW ALIGNMENT ROW — Karar kartında "🧠 FLOW INTELLIGENCE" satırı.
 *
 * Vizyon:
 *   - Tek satır özet ("GÜÇLÜ AYI ✓")
 *   - Tıklanabilir → drilldown (CVD, VPIN, SMC, Liq detayları)
 *   - Bilişsel yük sıfır, isteyince detay
 *
 * Gösterilen sinyaller:
 *   - Smart Money (VPIN durumu)
 *   - Volume Delta (CVD)
 *   - Divergence
 *   - SMC event'leri (son)
 *   - Liq magnet
 */

import { useState } from "react";
import type { FlowIntelligenceResult } from "@/lib/orderflow/flowIntelligence";
import { formatCvd } from "@/lib/orderflow/cvd";

interface Props {
  flow: FlowIntelligenceResult | null;
}

export function FlowAlignmentRow({ flow }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!flow) {
    return (
      <div className="bg-surface-s2 rounded-md p-3 text-text-t3 text-xs">
        Flow Intelligence: hazırlanıyor...
      </div>
    );
  }

  // Color coding based on alignment
  const colorClass = flow.vetoed
    ? "text-signal-down"
    : flow.totalAdjustment > 5
    ? "text-signal-up"
    : flow.totalAdjustment > 0
    ? "text-warning"
    : flow.totalAdjustment < -5
    ? "text-signal-down"
    : flow.totalAdjustment < 0
    ? "text-warning"
    : "text-text-t3";

  const icon = flow.vetoed
    ? "⚠"
    : flow.totalAdjustment > 0
    ? "✓"
    : flow.totalAdjustment < 0
    ? "⚠"
    : "○";

  const adjustmentText =
    flow.totalAdjustment > 0
      ? `+${flow.totalAdjustment}`
      : flow.totalAdjustment < 0
      ? `${flow.totalAdjustment}`
      : "0";

  return (
    <div
      className="bg-surface-s2 hover:bg-surface-s3 rounded-md transition-colors"
      data-testid="flow-alignment-row"
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-3 text-left flex items-center justify-between gap-2"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-t4 text-xs font-mono shrink-0">🧠</span>
          <span className="text-text-t2 text-xs font-medium shrink-0">
            FLOW
          </span>
          <span className={`${colorClass} text-xs font-medium truncate`}>
            {icon} {flow.humanSummary}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`${colorClass} text-xs font-mono font-bold tabular-nums`}
            data-testid="flow-adjustment"
          >
            {adjustmentText}
          </span>
          <span className="text-text-t4 text-xs">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div
          className="border-t border-border px-3 py-2 space-y-1.5"
          data-testid="flow-drilldown"
        >
          {/* CVD */}
          <DetailRow
            label="Smart Money"
            value={
              flow.flowVerdict.vpin && flow.flowVerdict.vpin.ready
                ? `${flow.flowVerdict.vpin.toxicity.toUpperCase()} (VPIN ${flow.flowVerdict.vpin.vpin.toFixed(2)})`
                : "Hesaplanıyor..."
            }
          />
          <DetailRow
            label="Volume Delta (5dk)"
            value={formatCvd(flow.flowVerdict.cvd.w5m.cvdUsd)}
            tone={
              flow.flowVerdict.cvd.w5m.direction === "bullish"
                ? "up"
                : flow.flowVerdict.cvd.w5m.direction === "bearish"
                ? "down"
                : "neutral"
            }
          />
          <DetailRow
            label="Divergence"
            value={
              flow.flowVerdict.divergence.confluence
                ? `⚠ ${flow.flowVerdict.divergence.confluenceType.replace("_", " ").toUpperCase()}`
                : "Yok (uyumlu)"
            }
            tone={flow.flowVerdict.divergence.confluence ? "down" : "neutral"}
          />
          {flow.smc.recentEvents.length > 0 && (
            <DetailRow
              label="SMC"
              value={flow.smc.recentEvents[0].label}
              tone={
                flow.smc.recentEvents[0].direction === "bullish"
                  ? "up"
                  : "down"
              }
            />
          )}
          {flow.liqMap.nearestLongLiq || flow.liqMap.nearestShortLiq ? (
            <DetailRow
              label="Liq Magnet"
              value={
                flow.liqMap.magnetZones.length > 0
                  ? `${flow.liqMap.magnetZones.length} zone yakın`
                  : "Uzak"
              }
            />
          ) : null}
          {flow.vetoed && (
            <div className="mt-2 p-2 bg-signal-down/10 border border-signal-down/30 rounded text-signal-down text-xs font-medium">
              VETO: {flow.vetoReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  tone?: "up" | "down" | "neutral";
}

function DetailRow({ label, value, tone = "neutral" }: DetailRowProps) {
  const valueColor =
    tone === "up"
      ? "text-signal-up"
      : tone === "down"
      ? "text-signal-down"
      : "text-text-t2";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-t4">{label}</span>
      <span className={`${valueColor} font-mono tabular-nums`}>{value}</span>
    </div>
  );
}
