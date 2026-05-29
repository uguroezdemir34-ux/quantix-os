import { NextResponse } from "next/server";

export async function POST() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_VIP_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json({ ok: false, error: "Missing env vars" }, { status: 400 });
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "✅ Quantix test mesajı." }),
    }
  );

  const data = await res.json();
  return NextResponse.json({ ok: data.ok });
}
