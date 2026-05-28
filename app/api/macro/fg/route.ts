/**
 * /api/macro/fg — Fear & Greed Index server-side proxy.
 *
 * Browser direkt alternative.me'ye gitmek yerine bu route'tan çekiyor:
 *   - CORS sorunsuz
 *   - Server-side cache → birden fazla scan döngüsü tek API çağrısı yapar
 *   - 4sn timeout korunur
 */

import { NextResponse } from "next/server";
import { fetchFearGreed } from "@/lib/macro/fetch";
import { getFgInfo } from "@/lib/macro/regime";

export async function GET() {
  const now = Date.now();
  const result = await fetchFearGreed(now);
  const info = getFgInfo(result.value);
  return NextResponse.json({
    value: result.value,
    label: info.label,
    cssClass: info.cssClass,
    fetchedAt: result.fetchedAt,
    source: result.source,
  });
}
