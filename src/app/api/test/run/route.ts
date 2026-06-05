import { NextRequest, NextResponse } from "next/server";
import * as gmail from "@/lib/gmail";
import { runAutomationForMessages } from "@/lib/automation";
import { getFreshAccessToken, getOpsEmail } from "@/lib/google-auth";
import * as clientsDb from "@/lib/clients-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ============================================================
// TEST HARNESS — end-to-end email test over HTTPS
// ============================================================
// Injects a realistic inbound customer email into the ops inbox,
// runs the real agent on it (deterministic tools + templated reply),
// then returns the actual reply that was sent. Secret-gated.
// Remove after testing.
// ============================================================

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const from = body.from || "biggguy0047@gmail.com";
    const subject = body.subject || "Cleaning enquiry";
    const text = body.body || "Hi, can I get a quote?";

    const ops = getOpsEmail();
    const accessToken = await getFreshAccessToken(ops);

    // Optional: clear this test client's future bookings so availability is clean.
    if (body.reset) {
      const removed = await clientsDb.deleteFutureBookingsForEmail(from);
      return NextResponse.json({ ok: true, reset: true, removedBookings: removed });
    }

    // 1. Inject a realistic inbound email into the ops inbox.
    const inserted = await gmail.insertInbound(accessToken, { from, to: ops, subject, body: text });

    // 2. Run the real agent on it.
    const result = await runAutomationForMessages(accessToken, [inserted.id!]);

    // 3. Read back the actual reply(ies) that were sent.
    const sent = await gmail.getRecentSent(accessToken, 4);

    return NextResponse.json({
      ok: true,
      injected: { id: inserted.id, from, subject },
      agent: { processed: result.processed, errors: result.errors, actions: result.actions },
      replies: sent.map((s) => ({ to: s.to, subject: s.subject, body: s.body })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
