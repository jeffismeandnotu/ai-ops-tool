import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAutomationEnabled, setAutomationEnabled } from "@/lib/app-settings";
import { verifyCronSecret } from "@/lib/webhook-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest): Promise<boolean> {
  const fromHeader = req.headers.get("x-cron-secret");
  const fromQuery = req.nextUrl.searchParams.get("secret");
  if (verifyCronSecret(fromHeader) || verifyCronSecret(fromQuery)) return true;
  const session = await getServerSession(authOptions);
  return !!session;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ enabled: await getAutomationEnabled() });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const enabled = body?.enabled === true;
  await setAutomationEnabled(enabled);
  return NextResponse.json({ enabled });
}
