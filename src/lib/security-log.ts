import { neon } from "@neondatabase/serverless";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensureTable() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS security_events (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ DEFAULT NOW(),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warn',
    source TEXT,
    details TEXT,
    ip TEXT,
    sender TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_security_events_ts ON security_events (ts)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (event_type)`;
  _init = true;
}

export type SecurityEventType =
  | "auth_failure"
  | "rate_limit_hit"
  | "circuit_breaker"
  | "spend_cap"
  | "recipient_blocked"
  | "destructive_gate"
  | "payload_rejected"
  | "oidc_failure"
  | "injection_attempt"
  | "signature_failure";

export type Severity = "info" | "warn" | "critical";

export async function logSecurityEvent(event: {
  type: SecurityEventType;
  severity: Severity;
  source?: string;
  details?: string;
  ip?: string;
  sender?: string;
}): Promise<void> {
  try {
    await ensureTable();
    const sql = getDb();
    await sql`INSERT INTO security_events (event_type, severity, source, details, ip, sender)
      VALUES (${event.type}, ${event.severity}, ${event.source || null}, ${event.details || null}, ${event.ip || null}, ${event.sender || null})`;
  } catch {
    // never let security logging break a request
  }
}

export async function getRecentSecurityEvents(hours = 24, limit = 50): Promise<any[]> {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`SELECT * FROM security_events
    WHERE ts > NOW() - INTERVAL '1 hour' * ${hours}
    ORDER BY ts DESC LIMIT ${limit}`;
  return rows as any[];
}

export async function getSecurityEventCounts(hours = 24): Promise<Record<string, number>> {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`SELECT event_type, COUNT(*)::int AS cnt FROM security_events
    WHERE ts > NOW() - INTERVAL '1 hour' * ${hours}
    GROUP BY event_type ORDER BY cnt DESC`;
  const counts: Record<string, number> = {};
  for (const r of rows as any[]) {
    counts[r.event_type] = r.cnt;
  }
  return counts;
}
