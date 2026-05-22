import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readOpsLog, readProcessedEmails, getOpsLogSummary } from "@/lib/ops-log";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const view = req.nextUrl.searchParams.get("view") || "summary";

  switch (view) {
    case "summary":
      return NextResponse.json({ summary: getOpsLogSummary() });
    case "operations":
      return NextResponse.json({ operations: readOpsLog() });
    case "processed":
      return NextResponse.json({ processed: readProcessedEmails() });
    case "all":
      return NextResponse.json({
        summary: getOpsLogSummary(),
        operations: readOpsLog(),
        processed: readProcessedEmails(),
      });
    default:
      return NextResponse.json({ summary: getOpsLogSummary() });
  }
}
