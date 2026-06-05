import { NextRequest, NextResponse } from "next/server";
import { getFreshAccessToken, getOpsEmail } from "@/lib/google-auth";
import { getAutomationEnabled } from "@/lib/app-settings";
import { sendDueReminders } from "@/lib/booking-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Scheduled (vercel.json) — sends one-time reminders for upcoming bookings.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Respect the dashboard Start/Stop switch — no outbound while stopped.
  if (!(await getAutomationEnabled())) {
    return NextResponse.json({ ok: true, note: "automation stopped", sent: 0 });
  }
  try {
    const token = await getFreshAccessToken(getOpsEmail());
    const result = await sendDueReminders(token);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
