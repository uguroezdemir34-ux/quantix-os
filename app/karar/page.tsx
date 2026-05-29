"use client";

import { useState } from "react";
import { useScoreStore } from "@/lib/store/scoreStore";
import { PAIRS, type Pair } from "@/lib/constants/pairs";
import { VerdictBadge } from "@/components/karar/VerdictBadge";
import { ScoreBar } from "@/components/karar/ScoreBar";
import { ScoreBreakdown } from "@/components/karar/ScoreBreakdown";
import { BlocksList } from "@/components/karar/BlocksList";
import { ReasonsList } from "@/components/karar/ReasonsList";
import { DirectionBadge } from "@/components/karar/DirectionBadge";
import { FlowAlignmentRow } from "@/components/karar/FlowAlignmentRow";

export default function KararPage() {
  const [activePair, setActivePair] = useState<Pair>("BTC");
  const result = useScoreStore((s) => s.results[activePair]);
  const computing = useScoreStore((s) => s.computing);

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
          <FlowAlignmentRow flow={null} />
          <ScoreBreakdown sub={result.sub} reasons={result.reasons} />
          <BlocksList
            hardBlocks={result.blocks}
            softBlocks={result.softBlocks}
          />
          <ReasonsList reasons={result.reasons} />
        </>
      )}
    </div>
  );
}
