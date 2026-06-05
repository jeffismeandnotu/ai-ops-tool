import { neon } from "@neondatabase/serverless";

// ============================================================
// TRIAGE — risk scan (deterministic backstop) + classification log
// ============================================================
// The model classifies intent; this module gives a code-side risk
// signal that forces escalation regardless of what the model says,
// and persists the classification for audit.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensure() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS email_triage (
    message_id text PRIMARY KEY,
    thread_id text,
    intent text,
    confidence real,
    risk text,
    reason text,
    created_at timestamptz DEFAULT now()
  )`;
  _init = true;
}

const HUMAN = /\b(speak|talk|connect)\s+(to|with)\s+(a\s+)?(human|person|someone|representative|rep|agent|manager|owner)|real person|human being\b/i;
const MONEY_LEGAL = /\b(refund|charge\s?back|chargeback|dispute|lawyer|attorney|legal action|sue|lawsuit|small claims|bbb|better business bureau|fraud|scam|invoice dispute|overcharged|double charged)\b/i;
const ANGER = /\b(terrible|awful|horrible|worst|disgusting|furious|outraged|unacceptable|ruined|damaged|broke|broken|stained|scratched|negligent|incompetent|never again|disappointed|complaint|complain)\b/i;

export interface RiskScan {
  high: boolean;
  flags: string[];
}

// Pure, synchronous keyword scan over the inbound text.
export function scanRisk(text: string): RiskScan {
  const t = text || "";
  const flags: string[] = [];
  if (HUMAN.test(t)) flags.push("human_requested");
  if (MONEY_LEGAL.test(t)) flags.push("money_or_legal");
  if (ANGER.test(t)) flags.push("complaint_or_anger");
  return { high: flags.length > 0, flags };
}

export async function recordClassification(o: {
  messageId?: string;
  threadId?: string;
  intent: string;
  confidence: number;
  risk: string;
  reason?: string;
}): Promise<void> {
  await ensure();
  const sql = getDb();
  await sql`INSERT INTO email_triage (message_id, thread_id, intent, confidence, risk, reason, created_at)
    VALUES (${o.messageId || "unknown"}, ${o.threadId || ""}, ${o.intent}, ${o.confidence}, ${o.risk}, ${o.reason || ""}, now())
    ON CONFLICT (message_id) DO UPDATE SET intent=EXCLUDED.intent, confidence=EXCLUDED.confidence, risk=EXCLUDED.risk, reason=EXCLUDED.reason`;
}
