import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/webhook-verify";
import { purgeStaleIntents } from "@/lib/booking-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  if (!verifyCronSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const purged = await purgeStaleIntents();
    return NextResponse.json({ ok: true, purged });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
