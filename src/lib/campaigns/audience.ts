import { neon } from "@neondatabase/serverless";

// ============================================================
// AUDIENCE PROVIDER — seam for future swap to real clients table
// ============================================================
// Currently reads from the campaign_recipients table (demo data).
// To switch to real client data later, implement a new provider
// that queries the clients table and returns the same shape.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensureTable() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS campaign_recipients (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL DEFAULT '',
    vars JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  _init = true;
}

export interface Recipient {
  id: string;
  email: string;
  firstName: string;
  vars: Record<string, string>;
  active: boolean;
}

function toRecipient(row: any): Recipient {
  let vars: Record<string, string> = {};
  try {
    vars =
      typeof row.vars === "string" ? JSON.parse(row.vars) : row.vars || {};
  } catch {
    vars = {};
  }
  return {
    id: String(row.id),
    email: row.email,
    firstName: row.first_name || "",
    vars,
    active: row.active !== false,
  };
}

export async function seedDemoRecipients(): Promise<void> {
  await ensureTable();
  const sql = getDb();
  const demos = [
    {
      email: "demo1@example.com",
      first_name: "Demo Client",
      vars: { service: "Regular Clean", address: "123 Example St" },
    },
    {
      email: "demo2@example.com",
      first_name: "Test User",
      vars: { service: "Deep Clean", address: "456 Sample Ave" },
    },
    {
      email: "demo3@example.com",
      first_name: "Preview Recipient",
      vars: { service: "Vacation Rental Turnover", address: "789 Placeholder Rd" },
    },
  ];
  for (const d of demos) {
    await sql`INSERT INTO campaign_recipients (email, first_name, vars)
      VALUES (${d.email}, ${d.first_name}, ${JSON.stringify(d.vars)})
      ON CONFLICT (email) DO NOTHING`;
  }
}

export async function listRecipients(): Promise<Recipient[]> {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`SELECT * FROM campaign_recipients ORDER BY id`;
  return rows.map(toRecipient);
}

export async function getActiveRecipients(): Promise<Recipient[]> {
  await ensureTable();
  const sql = getDb();
  const rows =
    await sql`SELECT * FROM campaign_recipients WHERE active = true ORDER BY id`;
  return rows.map(toRecipient);
}

export async function addRecipient(
  email: string,
  firstName: string,
  vars?: Record<string, string>
): Promise<Recipient> {
  await ensureTable();
  const sql = getDb();
  const rows =
    await sql`INSERT INTO campaign_recipients (email, first_name, vars)
      VALUES (${email}, ${firstName}, ${JSON.stringify(vars || {})})
      ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, vars = EXCLUDED.vars, active = true, created_at = NOW()
      RETURNING *`;
  return toRecipient(rows[0]);
}

export async function removeRecipient(email: string): Promise<boolean> {
  await ensureTable();
  const sql = getDb();
  const rows =
    await sql`UPDATE campaign_recipients SET active = false WHERE email = ${email} RETURNING id`;
  return rows.length > 0;
}
