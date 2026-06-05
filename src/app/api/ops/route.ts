import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readOpsLog, readProcessedEmails, getOpsLogSummary, getUsageSummary } from "@/lib/ops-log";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const hasSecret = !!secret && secret === process.env.CRON_SECRET;
  if (!hasSecret) {
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
