import { NextRequest, NextResponse } from "next/server";
import { runAutomationCycle } from "@/lib/automation";

// This endpoint is called by a cron job every 5 minutes.
// On Vercel, use vercel.json crons. Locally, use setInterval or external cron.
//
// Security: requires CRON_SECRET header to prevent unauthorized triggers.

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the stored access token
  // In production, store the OAuth refresh token and refresh it here.
  // For now, use an environment variable set after first login.
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json(
      { error: "No access token configured. Sign in via the UI first to generate one." },
      { status: 500 }
    );
  }

  try {
    const result = await runAutomationCycle(accessToken);
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

// Also support manual trigger via POST (from the UI)
export async function POST(req: NextRequest) {
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "No access token" }, { status: 401 });
  }

  try {
    const result = await runAutomationCycle(accessToken);
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
