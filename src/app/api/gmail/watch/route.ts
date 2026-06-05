import { NextRequest, NextResponse } from "next/server";
import * as gmail from "@/lib/gmail";
import {
  getFreshAccessToken,
  getOpsEmail,
  saveWatchState,
} from "@/lib/google-auth";
import { verifyCronSecret } from "@/lib/webhook-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// ARM / RENEW GMAIL WATCH
// ============================================================
// Gmail watches expire after 7 days. This endpoint (re)arms the
// watch and stores the baseline historyId. Hit it once to start,
// and let the daily Vercel cron call it to renew.
// ============================================================

function topicName(): string {
  return (
    process.env.GMAIL_PUBSUB_TOPIC ||
    "projects/ai-ops-tool/topics/gmail-push"
  );
}

async function arm() {
  const email = getOpsEmail();
  const accessToken = await getFreshAccessToken(email);
  const res = await gmail.watchMailbox(accessToken, topicName());
  if (res.historyId) {
    await saveWatchState(email, String(res.historyId), res.expiration);
  }
  return {
    email,
    topic: topicName(),
    historyId: res.historyId,
    expiration: res.expiration
      ? new Date(Number(res.expiration)).toISOString()
      : null,
  };
}

// GET — used by the daily cron (secret in query) and manual arming.
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  if (!verifyCronSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await arm();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

// POST — manual arming from an authenticated session.
export async function POST() {
  const { getServerSession } = await import("next-auth");
  const { authOptions } = await import("@/lib/auth");
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await arm();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
