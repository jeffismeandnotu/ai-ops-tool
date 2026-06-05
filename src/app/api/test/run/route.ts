import { NextRequest, NextResponse } from "next/server";
import { getFreshAccessToken, getOpsEmail } from "@/lib/google-auth";
import { insertInbound, getRecentSent } from "@/lib/gmail";
import { runAutomationForMessages } from "@/lib/automation";
import * as waitlist from "@/lib/waitlist";
import * as calendar from "@/lib/calendar";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const token = await getFreshAccessToken(getOpsEmail());

  // --- Reset test state ---
  if (body.reset) {
    const sql = getDb();
    await sql`DELETE FROM bookings WHERE true`;
    await sql`DELETE FROM clients WHERE true`;
    await sql`DELETE FROM booking_phases WHERE true`;
    await sql`DELETE FROM processed_emails WHERE true`;
    return NextResponse.json({ ok: true, action: "reset" });
  }

  // --- Clear calendar ---
  if (body.clearCalendar) {
    try {
      const events = await calendar.listEvents(
        token,
        new Date().toISOString(),
        new Date(Date.now() + 30 * 86_400_000).toISOString()
      );
      for (const e of events) {
        const ev = e as any;
        const text = `${ev.summary || ""} ${ev.location || ""} ${ev.description || ""}`;
        if (/test|blackcomb|glacier|reminder|glow|clean/i.test(text)) {
          try { await calendar.deleteEvent(token, ev.id); } catch {}
        }
      }
    } catch {}
    return NextResponse.json({ ok: true, action: "clearCalendar" });
  }

  // --- Calendar query ---
  if (body.calendar) {
    const events = await calendar.listEvents(
      token,
      new Date().toISOString(),
      new Date(Date.now() + 30 * 86_400_000).toISOString()
    );
    return NextResponse.json({ ok: true, events });
  }

  // --- Waitlist add ---
  if (body.waitlistAdd) {
    const wl = await waitlist.addToWaitlist(body.waitlistAdd);
    return NextResponse.json({ ok: true, id: wl.id });
  }

  // --- Inject inbound + run automation ---
  if (body.from && body.body) {
    const opsEmail = getOpsEmail();
    const inserted = await insertInbound(token, {
      from: body.from,
      to: opsEmail,
      subject: body.subject || "Test",
      body: body.body,
      threadId: body.threadId,
      inReplyTo: body.inReplyTo,
    });

    const result = await runAutomationForMessages(token, [inserted.id!]);

    const sentAfter = await getRecentSent(token, 6);

    return NextResponse.json({
      ok: true,
      injected: { id: inserted.id, threadId: inserted.threadId },
      agent: { actions: result.actions, errors: result.errors },
      replies: sentAfter,
    });
  }

  return NextResponse.json({ error: "Unknown command" }, { status: 400 });
}
