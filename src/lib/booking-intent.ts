import { neon } from "@neondatabase/serverless";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensure() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS booking_intent (
    email TEXT PRIMARY KEY,
    service_id TEXT,
    proposed_date TEXT,
    proposed_time TEXT,
    raw_quote TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  _init = true;
}

export interface BookingIntent {
  email: string;
  serviceId: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
  rawQuote: string | null;
  updatedAt: string;
}

function toIntent(row: any): BookingIntent {
  return {
    email: row.email,
    serviceId: row.service_id || null,
    proposedDate: row.proposed_date || null,
    proposedTime: row.proposed_time || null,
    rawQuote: row.raw_quote || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
  };
}

export async function getIntent(email: string): Promise<BookingIntent | null> {
  await ensure();
  const sql = getDb();
  const rows = await sql`SELECT * FROM booking_intent
    WHERE email = ${email.toLowerCase()}
    AND updated_at > NOW() - INTERVAL '24 hours'
    LIMIT 1`;
  if (!rows.length) return null;
  return toIntent(rows[0]);
}

export async function setIntent(
  email: string,
  fields: {
    serviceId?: string;
    proposedDate?: string;
    proposedTime?: string;
    rawQuote?: string;
  }
): Promise<BookingIntent> {
  await ensure();
  const sql = getDb();
  const e = email.toLowerCase();
  const rows = await sql`INSERT INTO booking_intent (email, service_id, proposed_date, proposed_time, raw_quote, updated_at)
    VALUES (${e}, ${fields.serviceId || null}, ${fields.proposedDate || null}, ${fields.proposedTime || null}, ${fields.rawQuote || null}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      service_id = COALESCE(${fields.serviceId || null}, booking_intent.service_id),
      proposed_date = COALESCE(${fields.proposedDate || null}, booking_intent.proposed_date),
      proposed_time = COALESCE(${fields.proposedTime || null}, booking_intent.proposed_time),
      raw_quote = COALESCE(${fields.rawQuote || null}, booking_intent.raw_quote),
      updated_at = NOW()
    RETURNING *`;
  return toIntent(rows[0]);
}

export async function clearIntent(email: string): Promise<void> {
  await ensure();
  const sql = getDb();
  await sql`DELETE FROM booking_intent WHERE email = ${email.toLowerCase()}`;
}

export async function purgeStaleIntents(): Promise<number> {
  await ensure();
  const sql = getDb();
  const rows = await sql`DELETE FROM booking_intent
    WHERE updated_at <= NOW() - INTERVAL '24 hours'
    RETURNING email`;
  return rows.length;
}
