import { NextRequest, NextResponse } from "next/server";
import * as gmail from "@/lib/gmail";
import { runAutomationForMessages } from "@/lib/automation";
import {
  getFreshAccessToken,
  getWatchState,
  saveWatchState,
} from "@/lib/google-auth";
import { getAutomationEnabled } from "@/lib/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ============================================================
// GMAIL PUSH WEBHOOK
// ============================================================
// Pub/Sub POSTs here within seconds of an email landing.
// The notification carries only { emailAddress, historyId }, so we
// diff against the last stored historyId to fetch exactly the new
// messages, then run the automation on them. No polling.
// ============================================================

export async function POST(req: NextRequest) {
  // 1. Auth — shared secret in the push endpoint URL.
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.GMAIL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let emailAddress = "";
  try {
    // 2. Decode the wrapped Pub/Sub message.
    const body = await req.json();
    const dataB64 = body?.message?.data;
    if (!dataB64) {
      // Malformed but ack it so Pub/Sub doesn't retry forever.
      return NextResponse.json({ ok: true, note: "no data" });
    }
    const decoded = JSON.parse(
      Buffer.from(dataB64, "base64").toString("utf-8")
    );
    emailAddress = decoded.emailAddress;
    const notificationHistoryId = String(decoded.historyId);

    // 2b. Global Start/Stop switch (dashboard). If processing is OFF,
    //     advance the cursor so we don't reprocess a backlog when it's
    //     turned back on, then skip without touching the inbox.
    const enabled = await getAutomationEnabled();
    if (!enabled) {
      await saveWatchState(emailAddress, notificationHistoryId);
      return NextResponse.json({ ok: true, note: "automation stopped" });
    }

    // 3. Fresh access token from the stored refresh token.
    const accessToken = await getFreshAccessToken(emailAddress);

    // 4. Baseline historyId. If we have none yet, set it and wait for
    //    the next notification (nothing to diff against).
    const { historyId: lastHistoryId, expiration } = await getWatchState(
      emailAddress
    );
    if (!lastHistoryId) {
      await saveWatchState(emailAddress, notificationHistoryId);
      return NextResponse.json({ ok: true, note: "baseline set" });
    }

    // 5. Fetch only the new message IDs.
    const messageIds = await gmail.listAddedMessageIds(
      accessToken,
      lastHistoryId
    );

    // 6. Advance the cursor before processing so a slow run doesn't
    //    cause the next notification to re-pull the same window.
    await saveWatchState(emailAddress, notificationHistoryId);

    // 6b. Self-renew the watch when within 24h of expiry (or unknown).
    //     This makes the daily cron a safety net, not a hard dependency:
    //     any inbound activity keeps the watch alive.
    const soon = Date.now() + 24 * 60 * 60 * 1000;
    if (!expiration || expiration.getTime() < soon) {
      try {
        const topic =
          process.env.GMAIL_PUBSUB_TOPIC ||
          "projects/ai-ops-tool/topics/gmail-push";
        const w = await gmail.watchMailbox(accessToken, topic);
        if (w.historyId) {
          await saveWatchState(emailAddress, String(w.historyId), w.expiration);
        }
      } catch (e: any) {
        console.error("watch self-renew failed:", e?.message || e);
      }
    }

    if (messageIds.length === 0) {
      return NextResponse.json({ ok: true, processed: 0 });
    }

    // 7. Process. Dedup inside runAutomationForMessages makes retries safe.
    const result = await runAutomationForMessages(accessToken, messageIds);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("gmail webhook error:", emailAddress, err?.message || err);
    // 500 → Pub/Sub retries. Dedup protects against double-processing.
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
