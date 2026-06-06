import { neon } from "@neondatabase/serverless";
import {
  getActiveRecipients,
  getRecipientsByIds,
  seedDemoRecipients,
} from "./audience";
import { render } from "./templates";
import { getSender } from "./sender";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _schedInit = false;
async function ensureScheduledTable() {
  if (_schedInit) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS scheduled_campaigns (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    template_id TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    recipient_ids JSONB,
    send_at TIMESTAMPTZ NOT NULL,
    mode TEXT NOT NULL DEFAULT 'test',
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  _schedInit = true;
}

let _sendsInit = false;
async function ensureSendsTable() {
  if (_sendsInit) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS campaign_sends (
    id BIGSERIAL PRIMARY KEY,
    scheduled_campaign_id BIGINT NOT NULL,
    recipient_email TEXT NOT NULL,
    send_date DATE NOT NULL,
    provider TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    sent_at TIMESTAMPTZ,
    UNIQUE (scheduled_campaign_id, recipient_email, send_date)
  )`;
  _sendsInit = true;
}

export type CampaignMode = "preview" | "test" | "live";

export interface ScheduledCampaign {
  id: string;
  name: string;
  templateId: string;
  audience: string;
  recipientIds: string[] | null;
  sendAt: string;
  mode: string;
  status: string;
  createdAt: string;
}

interface RenderedEmail {
  to: string;
  firstName: string;
  subject: string;
  body: string;
}

interface SendResultItem {
  to: string;
  status: "sent" | "skipped" | "error" | "preview";
  id?: string;
  error?: string;
}

export interface CampaignRunResult {
  scheduledCampaignId: string;
  mode: CampaignMode;
  date: string;
  rendered: RenderedEmail[];
  results: SendResultItem[];
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function toScheduledCampaign(row: any): ScheduledCampaign {
  let recipientIds: string[] | null = null;
  if (row.recipient_ids) {
    try {
      recipientIds =
        typeof row.recipient_ids === "string"
          ? JSON.parse(row.recipient_ids)
          : row.recipient_ids;
    } catch {
      recipientIds = null;
    }
  }
  return {
    id: String(row.id),
    name: row.name,
    templateId: row.template_id,
    audience: row.audience,
    recipientIds,
    sendAt: row.send_at
      ? new Date(row.send_at).toISOString()
      : "",
    mode: row.mode,
    status: row.status,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : "",
  };
}

export async function scheduleCampaign(opts: {
  name: string;
  templateId: string;
  audience: "all" | "selected";
  recipientIds?: string[];
  sendAt: string;
  mode?: string;
}): Promise<ScheduledCampaign> {
  await ensureScheduledTable();
  const sql = getDb();
  const mode = opts.mode || "test";
  const recipientIds =
    opts.audience === "selected" && opts.recipientIds
      ? JSON.stringify(opts.recipientIds)
      : null;
  const rows = await sql`INSERT INTO scheduled_campaigns (name, template_id, audience, recipient_ids, send_at, mode)
    VALUES (${opts.name}, ${opts.templateId}, ${opts.audience}, ${recipientIds}, ${opts.sendAt}, ${mode})
    RETURNING *`;
  return toScheduledCampaign(rows[0]);
}

export async function cancelCampaign(id: string): Promise<boolean> {
  await ensureScheduledTable();
  const sql = getDb();
  const rows = await sql`UPDATE scheduled_campaigns SET status = 'cancelled'
    WHERE id = ${Number(id)} AND status = 'scheduled' RETURNING id`;
  return rows.length > 0;
}

export async function listScheduledCampaigns(): Promise<ScheduledCampaign[]> {
  await ensureScheduledTable();
  const sql = getDb();
  const rows =
    await sql`SELECT * FROM scheduled_campaigns ORDER BY send_at DESC`;
  return rows.map(toScheduledCampaign);
}

async function resolveRecipients(sc: ScheduledCampaign) {
  await seedDemoRecipients();
  if (sc.audience === "selected" && sc.recipientIds && sc.recipientIds.length > 0) {
    return getRecipientsByIds(sc.recipientIds);
  }
  return getActiveRecipients();
}

export async function runScheduled(
  id: string,
  modeOverride?: CampaignMode
): Promise<CampaignRunResult> {
  await ensureScheduledTable();
  await ensureSendsTable();

  const sql = getDb();
  const scRows =
    await sql`SELECT * FROM scheduled_campaigns WHERE id = ${Number(id)} LIMIT 1`;
  if (scRows.length === 0) {
    throw new Error(`Scheduled campaign ${id} not found`);
  }
  const sc = toScheduledCampaign(scRows[0]);
  const mode = modeOverride || (sc.mode as CampaignMode) || "preview";

  if (mode === "live" && process.env.CAMPAIGNS_ENABLED !== "true") {
    throw new Error(
      "Live sends are disabled. Set CAMPAIGNS_ENABLED=true to enable."
    );
  }

  const recipients = await resolveRecipients(sc);
  const date = todayStr();

  const rendered: RenderedEmail[] = [];
  for (const r of recipients) {
    const vars: Record<string, string> = {
      first_name: r.firstName,
      email: r.email,
      date,
      ...r.vars,
    };
    const merged = render(sc.templateId, vars);
    if (!merged) continue;
    rendered.push({
      to: r.email,
      firstName: r.firstName,
      subject: merged.subject,
      body: merged.body,
    });
  }

  if (mode === "preview") {
    return {
      scheduledCampaignId: id,
      mode,
      date,
      rendered,
      results: rendered.map((r) => ({ to: r.to, status: "preview" as const })),
    };
  }

  const sender = getSender();
  const results: SendResultItem[] = [];
  const provider = (
    process.env.CAMPAIGN_EMAIL_PROVIDER || "gmail"
  ).toLowerCase();

  if (mode === "test") {
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
    await sql`UPDATE scheduled_campaigns SET status = 'sent' WHERE id = ${Number(id)} AND status = 'scheduled'`;
    return { scheduledCampaignId: id, mode, date, rendered, results };
  }

  for (const email of rendered) {
    const existing =
      await sql`SELECT id FROM campaign_sends WHERE scheduled_campaign_id = ${Number(id)} AND recipient_email = ${email.to} AND send_date = ${date} LIMIT 1`;
    if (existing.length > 0) {
      results.push({ to: email.to, status: "skipped" });
      continue;
    }

    const res = await sender.send(email.to, email.subject, email.body);

    await sql`INSERT INTO campaign_sends (scheduled_campaign_id, recipient_email, send_date, provider, status, error, sent_at)
      VALUES (${Number(id)}, ${email.to}, ${date}, ${provider}, ${res.ok ? "sent" : "error"}, ${res.error || null}, NOW())
      ON CONFLICT (scheduled_campaign_id, recipient_email, send_date) DO NOTHING`;

    results.push({
      to: email.to,
      status: res.ok ? "sent" : "error",
      id: res.id,
      error: res.error,
    });
  }

  await sql`UPDATE scheduled_campaigns SET status = 'sent' WHERE id = ${Number(id)} AND status = 'scheduled'`;
  return { scheduledCampaignId: id, mode, date, rendered, results };
}

export async function runDue(): Promise<CampaignRunResult[]> {
  await ensureScheduledTable();
  const sql = getDb();
  const dueRows =
    await sql`SELECT * FROM scheduled_campaigns WHERE status = 'scheduled' AND send_at <= NOW()`;

  const results: CampaignRunResult[] = [];
  for (const row of dueRows) {
    const sc = toScheduledCampaign(row);
    try {
      const result = await runScheduled(sc.id, sc.mode as CampaignMode);
      results.push(result);
      await sql`UPDATE scheduled_campaigns SET status = 'sent' WHERE id = ${Number(sc.id)}`;
    } catch (e: any) {
      await sql`UPDATE scheduled_campaigns SET status = 'error' WHERE id = ${Number(sc.id)}`;
      results.push({
        scheduledCampaignId: sc.id,
        mode: sc.mode as CampaignMode,
        date: todayStr(),
        rendered: [],
        results: [{ to: "n/a", status: "error", error: e.message || String(e) }],
      });
    }
  }

  return results;
}

export async function updateSendStatus(
  scheduledCampaignId: number,
  recipientEmail: string,
  status: string,
  error?: string
): Promise<void> {
  await ensureSendsTable();
  const sql = getDb();
  await sql`UPDATE campaign_sends SET status = ${status}, error = ${error || null}
    WHERE scheduled_campaign_id = ${scheduledCampaignId} AND recipient_email = ${recipientEmail}`;
}
