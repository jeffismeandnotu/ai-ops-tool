import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readOpsLog, readProcessedEmails, getOpsLogSummary, getUsageSummary } from "@/lib/ops-log";
import { verifyCronSecret } from "@/lib/webhook-verify";
import { getRecentSecurityEvents, getSecurityEventCounts } from "@/lib/security-log";

export async function GET(req: NextRequest) {
  const fromHeader = req.headers.get("x-cron-secret");
  const fromQuery = req.nextUrl.searchParams.get("secret");
  if (!verifyCronSecret(fromHeader) && !verifyCronSecret(fromQuery)) {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const view = req.nextUrl.searchParams.get("view") || "summary";

  try {
    switch (view) {
      case "summary":
        return NextResponse.json({ summary: await getOpsLogSummary() });
      case "operations":
        return NextResponse.json({ operations: await readOpsLog() });
      case "processed":
        return NextResponse.json({ processed: await readProcessedEmails() });
      case "usage":
        return NextResponse.json({ usage: await getUsageSummary() });
      case "security":
        return NextResponse.json({
          events: await getRecentSecurityEvents(),
          counts: await getSecurityEventCounts(),
        });
      case "all":
        return NextResponse.json({
          summary: await getOpsLogSummary(),
          operations: await readOpsLog(),
          processed: await readProcessedEmails(),
        });
      default:
        return NextResponse.json({ summary: await getOpsLogSummary() });
    }
  } catch (err: any) {
    return NextResponse.json({ summary: `Error loading ops log: ${err.message}` });
  }
}
