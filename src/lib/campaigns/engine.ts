import { neon } from "@neondatabase/serverless";
import { getCampaign } from "./config";
import { getActiveRecipients, seedDemoRecipients } from "./audience";
import { render } from "./templates";
import { getSender } from "./sender";

// ============================================================
// CAMPAIGN ENGINE — render, send, deduplicate
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensureLedger() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS campaign_sends (
    id BIGSERIAL PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    send_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT,
    sent_at TIMESTAMPTZ,
    UNIQUE (campaign_id, recipient_email, send_date)
  )`;
  _init = true;
}

export type CampaignMode = "preview" | "test" | "live";

interface RenderedEmail {
  to: string;
  firstName: string;
  subject: string;
  body: string;
}

interface SendResult {
  to: string;
  status: "sent" | "skipped" | "error" | "preview";
  id?: string;
  error?: string;
}

export interface CampaignRunResult {
  campaignId: string;
  mode: CampaignMode;
  date: string;
  rendered: RenderedEmail[];
  results: SendResult[];
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runCampaign(
  campaignId: string,
  mode: CampaignMode = "preview"
): Promise<CampaignRunResult> {
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    throw new Error(`Unknown campaign: ${campaignId}`);
  }

  // Live mode requires explicit opt-in
  if (mode === "live" && process.env.CAMPAIGNS_ENABLED !== "true") {
    throw new Error(
      "Live sends are disabled. Set CAMPAIGNS_ENABLED=true to enable."
    );
  }

  await ensureLedger();
  await seedDemoRecipients();

  const recipients = await getActiveRecipients();
  const date = todayStr();

  // Render all emails
  const rendered: RenderedEmail[] = [];
  for (const r of recipients) {
    const vars: Record<string, string> = {
      first_name: r.firstName,
      email: r.email,
      date,
      ...r.vars,
    };
    const merged = render(campaign.templateId, vars);
    if (!merged) continue;
    rendered.push({
      to: r.email,
      firstName: r.firstName,
      subject: merged.subject,
      body: merged.body,
    });
  }

  // Preview — return rendered emails, no sends, no ledger writes
  if (mode === "preview") {
    return {
      campaignId,
      mode,
      date,
      rendered,
      results: rendered.map((r) => ({ to: r.to, status: "preview" as const })),
    };
  }

  const sender = getSender();
  const results: SendResult[] = [];
  const sql = getDb();

  if (mode === "test") {
    // Test mode — send everything to the test address only
    const testAddr = process.env.CAMPAIGN_TEST_ADDRESS;
    if (!testAddr) {
      throw new Error(
        "CAMPAIGN_TEST_ADDRESS is not set. Cannot run in test mode."
      );
    }
    for (const email of rendered) {
      const res = await sender.send(
        testAddr,
        `[TEST] ${email.subject}`,
        `[This email would go to ${email.to}]\n\n${email.body}`
      );
      results.push({
        to: testAddr,
        status: res.ok ? "sent" : "error",
        id: res.id,
        error: res.error,
      });
    }
    return { campaignId, mode, date, rendered, results };
  }

  // Live mode — send to real recipients, idempotent via ledger
  for (const email of rendered) {
    // Check ledger for exactly-once
    const existing =
      await sql`SELECT id FROM campaign_sends WHERE campaign_id = ${campaignId} AND recipient_email = ${email.to} AND send_date = ${date} LIMIT 1`;
    if (existing.length > 0) {
      results.push({ to: email.to, status: "skipped" });
      continue;
    }

    const res = await sender.send(email.to, email.subject, email.body);

    const provider = (
      process.env.CAMPAIGN_EMAIL_PROVIDER || "gmail"
    ).toLowerCase();
    await sql`INSERT INTO campaign_sends (campaign_id, recipient_email, send_date, status, provider, sent_at)
      VALUES (${campaignId}, ${email.to}, ${date}, ${res.ok ? "sent" : "error"}, ${provider}, NOW())
      ON CONFLICT (campaign_id, recipient_email, send_date) DO NOTHING`;

    results.push({
      to: email.to,
      status: res.ok ? "sent" : "error",
      id: res.id,
      error: res.error,
    });
  }

  return { campaignId, mode, date, rendered, results };
}
