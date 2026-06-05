import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getFreshAccessToken, getOpsEmail } from "@/lib/google-auth";
import * as calendar from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const log: string[] = [];

  async function del(name: string, query: ReturnType<typeof sql>) {
    try {
      const rows = await query;
      log.push(`${name}: ${rows.length} deleted`);
    } catch (e: any) {
      log.push(`${name}: ERR ${e.message?.slice(0, 80)}`);
    }
  }

  // FK-safe order: children first, then parents
  await del("bookings", sql`DELETE FROM bookings WHERE true RETURNING 1`);
  await del("quotes", sql`DELETE FROM quotes WHERE true RETURNING 1`);
  await del("inquiries", sql`DELETE FROM inquiries WHERE true RETURNING 1`);
  await del("email_log", sql`DELETE FROM email_log WHERE true RETURNING 1`);
  await del("waitlist", sql`DELETE FROM waitlist WHERE true RETURNING 1`);
  await del("booking_phases", sql`DELETE FROM booking_phases WHERE true RETURNING 1`);
  await del("email_triage", sql`DELETE FROM email_triage WHERE true RETURNING 1`);
  await del("ai_ops_log", sql`DELETE FROM ai_ops_log WHERE true RETURNING 1`);
  await del("ai_processed_emails", sql`DELETE FROM ai_processed_emails WHERE true RETURNING 1`);
  await del("ai_usage", sql`DELETE FROM ai_usage WHERE true RETURNING 1`);
  await del("clients", sql`DELETE FROM clients WHERE true RETURNING 1`);

  // Clear ops calendar
  let calDeleted = 0;
  try {
    const token = await getFreshAccessToken(getOpsEmail());
    const events = await calendar.listEvents(
      token,
      new Date("2026-01-01").toISOString(),
      new Date("2027-01-01").toISOString()
    );
    for (const e of events) {
      try {
        await calendar.deleteEvent(token, (e as any).id);
        calDeleted++;
      } catch {}
    }
    log.push(`calendar: ${calDeleted} events deleted`);
  } catch (e: any) {
    log.push(`calendar: ERR ${e.message?.slice(0, 80)}`);
  }

  return NextResponse.json({ ok: true, log });
}
