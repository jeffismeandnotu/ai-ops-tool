import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/webhook-verify";
import { runCampaign, type CampaignMode } from "@/lib/campaigns/engine";
import { listCampaigns } from "@/lib/campaigns/config";
import { listTemplates } from "@/lib/campaigns/templates";
import {
  listRecipients,
  addRecipient,
  removeRecipient,
} from "@/lib/campaigns/audience";

function authCheck(req: NextRequest): boolean {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return verifyCronSecret(secret);
}

export async function GET(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get("action") || "list";

  if (action === "list") {
    return NextResponse.json({
      campaigns: listCampaigns(),
      templates: listTemplates(),
    });
  }

  if (action === "recipients") {
    const recipients = await listRecipients();
    return NextResponse.json({ recipients });
  }

  if (action === "preview") {
    const campaignId = req.nextUrl.searchParams.get("campaign");
    if (!campaignId) {
      return NextResponse.json(
        { error: "campaign query param required" },
        { status: 400 }
      );
    }
    try {
      const result = await runCampaign(campaignId, "preview");
      return NextResponse.json(result);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || String(e) },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!authCheck(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get("action") || "";

  if (action === "add_recipient") {
    try {
      const body = await req.json();
      const { email, firstName, vars } = body;
      if (!email) {
        return NextResponse.json(
          { error: "email is required" },
          { status: 400 }
        );
      }
      const recipient = await addRecipient(
        email,
        firstName || "",
        vars || {}
      );
      return NextResponse.json({ ok: true, recipient });
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || String(e) },
        { status: 400 }
      );
    }
  }

  if (action === "remove_recipient") {
    try {
      const body = await req.json();
      const { email } = body;
      if (!email) {
        return NextResponse.json(
          { error: "email is required" },
          { status: 400 }
        );
      }
      const removed = await removeRecipient(email);
      return NextResponse.json({ ok: true, removed });
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || String(e) },
        { status: 400 }
      );
    }
  }

  if (action === "run") {
    const campaignId = req.nextUrl.searchParams.get("campaign");
    if (!campaignId) {
      return NextResponse.json(
        { error: "campaign query param required" },
        { status: 400 }
      );
    }
    const mode =
      (req.nextUrl.searchParams.get("mode") as CampaignMode) || "test";
    if (!["preview", "test", "live"].includes(mode)) {
      return NextResponse.json(
        { error: "mode must be preview, test, or live" },
        { status: 400 }
      );
    }
    try {
      const result = await runCampaign(campaignId, mode);
      return NextResponse.json(result);
    } catch (e: any) {
      return NextResponse.json(
        { error: e.message || String(e) },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
