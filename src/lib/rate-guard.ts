import { neon } from "@neondatabase/serverless";
import { logSecurityEvent } from "@/lib/security-log";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensureTable() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS rate_events (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ DEFAULT NOW(),
    sender TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'inbound'
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_events_sender_ts ON rate_events (sender, ts)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_events_ts ON rate_events (ts)`;
  _init = true;
}

async function recordEvent(sender: string, eventType = "inbound"): Promise<void> {
  await ensureTable();
  const sql = getDb();
  await sql`INSERT INTO rate_events (sender, event_type) VALUES (${sender.toLowerCase()}, ${eventType})`;
}

const DEFAULT_SENDER_CAP = 5;
const DEFAULT_GLOBAL_CAP = 100;
const DEFAULT_DAILY_SPEND = 25;

export async function checkSenderCap(
  sender: string
): Promise<{ allowed: boolean; count: number; cap: number }> {
  await ensureTable();
  const cap = parseInt(process.env.MAX_REPLIES_PER_SENDER_HOUR || "", 10) || DEFAULT_SENDER_CAP;
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*)::int AS cnt FROM rate_events
    WHERE sender = ${sender.toLowerCase()} AND ts > NOW() - INTERVAL '1 hour'`;
  const count = rows[0]?.cnt || 0;
  if (count < cap) {
    await recordEvent(sender);
    return { allowed: true, count: count + 1, cap };
  }
  return { allowed: false, count, cap };
}

export async function checkGlobalCap(): Promise<{ allowed: boolean; count: number; cap: number }> {
  await ensureTable();
  const cap = parseInt(process.env.MAX_INBOUND_PER_HOUR || "", 10) || DEFAULT_GLOBAL_CAP;
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*)::int AS cnt FROM rate_events
    WHERE ts > NOW() - INTERVAL '1 hour'`;
  const count = rows[0]?.cnt || 0;
  return { allowed: count < cap, count, cap };
}

export async function checkDailySpend(): Promise<{ allowed: boolean; spent: number; cap: number }> {
  const cap = parseFloat(process.env.MAX_DAILY_SPEND_USD || "") || DEFAULT_DAILY_SPEND;
  const sql = getDb();
  try {
    const rows = await sql`SELECT COALESCE(SUM(cost_usd), 0)::numeric AS spent FROM ai_usage
      WHERE created_at >= CURRENT_DATE`;
    const spent = parseFloat(rows[0]?.spent || "0");
    return { allowed: spent < cap, spent: Math.round(spent * 10000) / 10000, cap };
  } catch {
    return { allowed: true, spent: 0, cap };
  }
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  senderCount?: number;
  globalCount?: number;
  dailySpent?: number;
}

export async function runAllGuards(sender: string): Promise<GuardResult> {
  const daily = await checkDailySpend();
  if (!daily.allowed) {
    logSecurityEvent({ type: "spend_cap", severity: "critical", sender, details: `$${daily.spent}/$${daily.cap}` });
    return { allowed: false, reason: `Daily spend cap reached ($${daily.spent}/$${daily.cap})`, dailySpent: daily.spent };
  }

  const global = await checkGlobalCap();
  if (!global.allowed) {
    logSecurityEvent({ type: "circuit_breaker", severity: "critical", details: `${global.count}/${global.cap} events/hr` });
    return { allowed: false, reason: `Global circuit breaker tripped (${global.count}/${global.cap} events/hr)`, globalCount: global.count };
  }

  const perSender = await checkSenderCap(sender);
  if (!perSender.allowed) {
    logSecurityEvent({ type: "rate_limit_hit", severity: "warn", sender, details: `${perSender.count}/${perSender.cap}/hr` });
    return { allowed: false, reason: `Sender rate limit (${perSender.count}/${perSender.cap} per hour for ${sender})`, senderCount: perSender.count };
  }

  return { allowed: true, senderCount: perSender.count, globalCount: global.count, dailySpent: daily.spent };
}
