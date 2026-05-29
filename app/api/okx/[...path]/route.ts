/**
 * OKX CATCH-ALL PROXY — /api/okx/api/v5/... isteklerini karşılar.
 *
 * GET  /api/okx/api/v5/<path>?<query>
 *   Header: X-OKX-Mode: demo | prod
 *
 * POST /api/okx/api/v5/<path>
 *   Body: { isDemo: boolean, body: object }
 *
 * Güvenlik: OKX secret asla browser'a çıkmaz.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  handleOkxProxy,
  loadServerConfigFromEnv,
} from "@/lib/okx/server-handler";

function buildOkxPath(req: NextRequest): string {
  // URL: /api/okx/api/v5/market/candles?instId=...
  // OKX path: /api/v5/market/candles?instId=...
  const url = new URL(req.url);
  const afterProxy = url.pathname.replace(/^\/api\/okx/, "");
  return afterProxy + (url.search ?? "");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const path = buildOkxPath(req);
  const isDemo = req.headers.get("X-OKX-Mode") === "demo";
  const config = loadServerConfigFromEnv(process.env);

  const result = await handleOkxProxy({ method: "GET", path, isDemo }, config);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let parsed: { isDemo?: boolean; body?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, err: "INVALID_JSON" }, { status: 400 });
  }

  const path = buildOkxPath(req);
  const config = loadServerConfigFromEnv(process.env);

  const result = await handleOkxProxy(
    { method: "POST", path, body: parsed.body, isDemo: !!parsed.isDemo },
    config,
  );
  return NextResponse.json(result);
}
