import { neon } from "@neondatabase/serverless";

// ============================================================
// OPERATIONS LOG — Neon Postgres for persistent storage
// ============================================================
// Serverless-compatible. Survives across Vercel invocations.
// Uses the same Neon database as CleanBook (separate tables).
// ============================================================

function getDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return sql;
}

export interface Operation {
  id: string;
  timestamp: string;
  type: string;
  email_id?: string;
  thread_id?: string;
  from_addr?: string;
  to_addrs?: string[];
  subject?: string;
  classification?: string;
  calendar_event_id?: string;
  details: string;
  verified: boolean;
}

export interface ProcessedEmail {
  message_id: string;
  thread_id: string;
  processed_at: string;
  classification: string;
  action_taken: string;
}

// --- Init tables (runs once, idempotent) ---
let _initialized = false;
async function ensureTables() {
  if (_initialized) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS ai_ops_log (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    type TEXT NOT NULL,
    email_id TEXT,
    thread_id TEXT,
    from_addr TEXT,
    to_addrs TEXT[],
    subject TEXT,
    classification TEXT,
    calendar_event_id TEXT,
    details TEXT NOT NULL,
    verified BOOLEAN DEFAULT true
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ai_processed_emails (
    message_id TEXT PRIMARY KEY,
    thread_id TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    classification TEXT,
    action_taken TEXT
  )`;
  _initialized = true;
}

// --- Operations Log ---
export async function appendOperation(op: {
  type: string;
  emailId?: string;
  threadId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  classification?: string;
  calendarEventId?: string;
  details: string;
  verified: boolean;
}): Promise<Operation> {
  await ensureTables();
  const sql = getDb();
  const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  await sql`INSERT INTO ai_ops_log (id, type, email_id, thread_id, from_addr, to_addrs, subject, classification, calendar_event_id, details, verified)
    VALUES (${id}, ${op.type}, ${op.emailId || null}, ${op.threadId || null}, ${op.from || null}, ${op.to || null}, ${op.subject || null}, ${op.classification || null}, ${op.calendarEventId || null}, ${op.details}, ${op.verified})`;
  
  return {
    id,
    timestamp: new Date().toISOString(),
    type: op.type,
    email_id: op.emailId,
    thread_id: op.threadId,
    from_addr: op.from,
    to_addrs: op.to,
    subject: op.subject,
    classification: op.classification,
    calendar_event_id: op.calendarEventId,
    details: op.details,
    verified: op.verified,
  };
}

// --- Processed Emails ---
export async function markEmailProcessed(entry: {
  messageId: string;
  threadId?: string;
  processedAt?: string;
  classification: string;
  actionTaken: string;
}) {
  await ensureTables();
  const sql = getDb();
  await sql`INSERT INTO ai_processed_emails (message_id, thread_id, classification, action_taken)
    VALUES (${entry.messageId}, ${entry.threadId || ''}, ${entry.classification}, ${entry.actionTaken})
    ON CONFLICT (message_id) DO NOTHING`;
}

export async function isEmailProcessed(messageId: string): Promise<boolean> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT 1 FROM ai_processed_emails WHERE message_id = ${messageId} LIMIT 1`;
  return rows.length > 0;
}

// --- Queries ---
export async function readOpsLog(): Promise<Operation[]> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM ai_ops_log ORDER BY timestamp DESC LIMIT 100`;
  return rows as any;
}

export async function readProcessedEmails(): Promise<ProcessedEmail[]> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM ai_processed_emails ORDER BY processed_at DESC LIMIT 100`;
  return rows as any;
}

export async function getOpsLogSummary(): Promise<string> {
  await ensureTables();
  const sql = getDb();
  
  const totalOps = await sql`SELECT COUNT(*) as cnt FROM ai_ops_log`;
  const recentOps = await sql`SELECT * FROM ai_ops_log WHERE timestamp > NOW() - INTERVAL '24 hours' ORDER BY timestamp DESC LIMIT 10`;
  const totalProcessed = await sql`SELECT COUNT(*) as cnt FROM ai_processed_emails`;
  const recentProcessed = await sql`SELECT * FROM ai_processed_emails ORDER BY processed_at DESC LIMIT 5`;

  const lines = [
    `=== OPERATIONS LOG SUMMARY ===`,
    `Total operations: ${totalOps[0]?.cnt || 0}`,
    `Last 24h: ${recentOps.length} operations`,
    `Processed emails: ${totalProcessed[0]?.cnt || 0}`,
    ``,
    `Recent operations (last 24h):`,
    ...recentOps.map((op: any) =>
      `  [${(op.timestamp || '').toString().slice(11, 19)}] ${op.type}: ${(op.details || '').slice(0, 100)}`
    ),
    ``,
    `Recently processed emails:`,
    ...recentProcessed.map((p: any) =>
      `  [${(p.processed_at || '').toString().slice(11, 19)}] ${p.classification}: ${(p.action_taken || '').slice(0, 80)}`
    ),
  ];

  return lines.join("\n");
}

export async function getRecentOperations(hours = 24): Promise<Operation[]> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM ai_ops_log WHERE timestamp > NOW() - INTERVAL '1 hour' * ${hours} ORDER BY timestamp DESC`;
  return rows as any;
}
