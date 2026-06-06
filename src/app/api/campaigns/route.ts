import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyCronSecret } from "@/lib/webhook-verify";
import { listTemplates } from "@/lib/campaigns/templates";
import { render } from "@/lib/campaigns/templates";
import {
  listRecipients,
  addRecipient,
  removeRecipient,
  seedDemoRecipients,
  getRecipientById,
} from "@/lib/campaigns/audience";
import {
  listScheduledCampaigns,
  scheduleCampaign,
  cancelCampaign,
  clearHistory,
  runScheduled,
  runDue,
  type CampaignMode,
} from "@/lib/campaigns/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest): Promise<boolean> {
  const fromHeader = req.headers.get("x-cron-secret");
  const fromQuery = req.nextUrl.searchParams.get("secret");
  if (verifyCronSecret(fromHeader) || verifyCronSecret(fromQuery)) return true;
  const session = await getServerSession(authOptions);
  return !!session;
}

function cronOnly(req: NextRequest): boolean {
  const fromHeader = req.headers.get("x-cron-secret");
  const fromQuery = req.nextUrl.searchParams.get("secret");
  return verifyCronSecret(fromHeader) || verifyCronSecret(fromQuery);
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const action = req.nextUrl.searchParams.get("action") || "templates";

  if (action === "templates") {
    return json({ templates: listTemplates() });
  }

  if (action === "recipients") {
    await seedDemoRecipients();
    const recipients = await listRecipients();
    return json({ recipients });
  }

  if (action === "scheduled") {
    const campaigns = await listScheduledCampaigns();
    return json({ campaigns });
  }

  if (action === "preview") {
    const templateId = req.nextUrl.searchParams.get("template");
    const recipientId = req.nextUrl.searchParams.get("recipient");
    if (!templateId) {
      return json({ error: "template query param required" }, 400);
    }

    let vars: Record<string, string> = {
      first_name: "Demo",
      email: "demo@example.com",
      date: new Date().toISOString().slice(0, 10),
    };

    if (recipientId) {
      const r = await getRecipientById(recipientId);
      if (r) {
        vars = {
          first_name: r.firstName,
          email: r.email,
          date: new Date().toISOString().slice(0, 10),
          ...r.vars,
        };
      }
    }

    const rendered = render(templateId, vars);
    if (!rendered) {
      return json({ error: `Unknown template: ${templateId}` }, 400);
    }

    return json({ preview: rendered });
  }

  if (action === "run-due") {
    if (!cronOnly(req)) {
      return json({ error: "run-due requires CRON_SECRET" }, 403);
    }
    try {
      const results = await runDue();
      return json({ ok: true, results });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 500);
    }
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const action = req.nextUrl.searchParams.get("action") || "";

  if (action === "add-recipient") {
    try {
      const body = await req.json();
      const { email, firstName, vars } = body;
      if (!email) return json({ error: "email is required" }, 400);
      const recipient = await addRecipient(email, firstName || "", vars || {});
      return json({ ok: true, recipient });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 400);
    }
  }

  if (action === "remove-recipient") {
    try {
      const body = await req.json();
      const { email } = body;
      if (!email) return json({ error: "email is required" }, 400);
      const removed = await removeRecipient(email);
      return json({ ok: true, removed });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 400);
    }
  }

  if (action === "schedule") {
    try {
      const body = await req.json();
      const { name, templateId, audience, recipientIds, sendAt, mode } = body;
      if (!name || !templateId || !sendAt) {
        return json(
          { error: "name, templateId, and sendAt are required" },
          400
        );
      }
      const campaign = await scheduleCampaign({
        name,
        templateId,
        audience: audience || "all",
        recipientIds,
        sendAt,
        mode,
      });
      return json({ ok: true, campaign });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 400);
    }
  }

  if (action === "cancel") {
    try {
      const body = await req.json();
      const { id } = body;
      if (!id) return json({ error: "id is required" }, 400);
      const cancelled = await cancelCampaign(id);
      return json({ ok: true, cancelled });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 400);
    }
  }

  if (action === "clear-history") {
    try {
      const count = await clearHistory();
      return json({ ok: true, deleted: count });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 400);
    }
  }

  if (action === "run") {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return json({ error: "id query param required" }, 400);
    const mode =
      (req.nextUrl.searchParams.get("mode") as CampaignMode) || "test";
    if (!["preview", "test", "live"].includes(mode)) {
      return json({ error: "mode must be preview, test, or live" }, 400);
    }
    try {
      const result = await runScheduled(id, mode);
      return json(result);
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 400);
    }
  }

  if (action === "run-due") {
    if (!cronOnly(req)) {
      return json({ error: "run-due requires CRON_SECRET" }, 403);
    }
    try {
      const results = await runDue();
      return json({ ok: true, results });
    } catch (e: any) {
      return json({ error: e.message || String(e) }, 500);
    }
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}
