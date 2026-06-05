import { neon } from "@neondatabase/serverless";

// ============================================================
// WAITLIST — clients waiting for a full day/slot
// ============================================================
// Offered in Phase 1 when the requested day has no free slot.
// When a cancellation frees a slot on that date, the earliest
// un-notified waitlist entry is auto-offered the opening.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensure() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS waitlist (
    id text PRIMARY KEY,
    client_email text NOT NULL,
    client_name text,
    service_id text NOT NULL,
    date text NOT NULL,
    thread_id text,
    notified boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
  )`;
  _init = true;
}

export interface WaitlistEntry {
  id: string;
  client_email: string;
  client_name: string | null;
  service_id: string;
  date: string;
  thread_id: string | null;
  notified: boolean;
}

export async function addToWaitlist(o: {
  clientEmail: string;
  clientName?: string;
  serviceId: string;
  date: string;
  threadId?: string;
}): Promise<{ id: string }> {
  await ensure();
  const sql = getDb();
  const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await sql`INSERT INTO waitlist (id, client_email, client_name, service_id, date, thread_id)
    VALUES (${id}, ${o.clientEmail}, ${o.clientName || null}, ${o.serviceId}, ${o.date}, ${o.threadId || null})`;
  return { id };
}

// Earliest un-notified entry for a date (the one to offer a freed slot to).
export async function nextWaitlistForDate(date: string): Promise<WaitlistEntry | null> {
  await ensure();
  const sql = getDb();
  const rows = await sql`SELECT * FROM waitlist WHERE date = ${date} AND notified = false ORDER BY created_at ASC LIMIT 1`;
  return rows.length ? (rows[0] as any) : null;
}

export async function markNotified(id: string): Promise<void> {
  await ensure();
  const sql = getDb();
  await sql`UPDATE waitlist SET notified = true WHERE id = ${id}`;
}
