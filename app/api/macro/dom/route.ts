/**
 * /api/macro/dom — BTC + USDT dominance server-side proxy.
 *
 * Browser direkt coingecko'ya gitmek yerine bu route'tan çekiyor:
 *   - CORS sorunsuz
 *   - Server-side cache → API rate limit'lere takılma riski azalır
 *   - 4sn timeout korunur
 *
 * Output: btcD, usdtD, dominance phase, market summary (F&G ile birlikte sentez)
 */

import { NextResponse } from "next/server";
import { fetchBtcDominance, fetchFearGreed } from "@/lib/macro/fetch";
import { getDominancePhase, getMarketSummary } from "@/lib/macro/regime";

export async function GET() {
  const now = Date.now();
  // F&G ve dominance paralel
  const [domResult, fgResult] = await Promise.all([
    fetchBtcDominance(now),
    fetchFearGreed(now),
  ]);

  const phase = getDominancePhase(domResult.btcD, domResult.usdtD);
  const summary = getMarketSummary(fgResult.value, domResult.usdtD);

  return NextResponse.json({
    btcD: domResult.btcD,
    usdtD: domResult.usdtD,
    phase: phase.phase,
    phaseLabel: phase.label,
    summary,
    fg: fgResult.value,
    fetchedAt: domResult.fetchedAt,
    source: domResult.source,
  });
}
