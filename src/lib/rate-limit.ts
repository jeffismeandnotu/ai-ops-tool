import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

// ============================================================
// TOKEN-BUCKET RATE LIMITER (Neon-backed)
// ============================================================
// Serverless-safe: no in-memory state. Each key's bucket is a row
// in the rate_limits table. On each request, refill tokens based
// on elapsed time, then try to consume one.
// ============================================================

let _init = false;
async function ensureTable() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    tokens NUMERIC NOT NULL,
    last_refill TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  _init = true;
}

interface RateLimitOpts {
  key: string;
  maxTokens: number;
  refillRate: number;  // tokens per second
  consume?: number;
}

async function checkRateLimit(opts: RateLimitOpts): Promise<{ allowed: boolean; remaining: number }> {
  await ensureTable();
  const sql = getDb();
  const { key, maxTokens, refillRate, consume = 1 } = opts;

  const rows = await sql`SELECT tokens, last_refill FROM rate_limits WHERE key = ${key}`;
  const now = new Date();

  if (rows.length === 0) {
    const remaining = maxTokens - consume;
    await sql`INSERT INTO rate_limits (key, tokens, last_refill) VALUES (${key}, ${remaining}, ${now.toISOString()})
      ON CONFLICT (key) DO NOTHING`;
    return { allowed: true, remaining };
  }

  const row = rows[0];
  const elapsed = (now.getTime() - new Date(row.last_refill as string).getTime()) / 1000;
  const refilled = Math.min(maxTokens, Number(row.tokens) + elapsed * refillRate);

  if (refilled < consume) {
    return { allowed: false, remaining: Math.floor(refilled) };
  }

  const newTokens = refilled - consume;
  await sql`UPDATE rate_limits SET tokens = ${newTokens}, last_refill = ${now.toISOString()} WHERE key = ${key}`;
  return { allowed: true, remaining: Math.floor(newTokens) };
}

export function withRateLimit(opts: {
  keyPrefix: string;
  maxTokens?: number;
  refillRate?: number;
  keyExtractor?: (req: NextRequest) => string;
}) {
  const { keyPrefix, maxTokens = 30, refillRate = 0.5, keyExtractor } = opts;

  return async function rateLimitMiddleware(
    req: NextRequest,
    handler: (req: NextRequest) => Promise<NextResponse>
  ): Promise<NextResponse> {
    const keySuffix = keyExtractor
      ? keyExtractor(req)
      : req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const key = `${keyPrefix}:${keySuffix}`;

    const result = await checkRateLimit({ key, maxTokens, refillRate });
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: Math.ceil(1 / refillRate) },
        { status: 429, headers: { "Retry-After": String(Math.ceil(1 / refillRate)) } }
      );
    }
    return handler(req);
  };
}

// ============================================================
// PAYLOAD SIZE + SHAPE CAPS
// ============================================================
// Rejects requests that exceed a byte-size cap or fail a shape
// validation function. Applied before parsing to prevent DoS
// from oversized payloads.
// ============================================================

export interface PayloadCapOpts {
  maxBytes?: number;
  validateShape?: (body: any) => string | null;
}

export function withPayloadCaps(opts: PayloadCapOpts = {}) {
  const { maxBytes = 65536, validateShape } = opts;

  return async function payloadCapMiddleware(
    req: NextRequest,
    handler: (req: NextRequest) => Promise<NextResponse>
  ): Promise<NextResponse> {
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > maxBytes) {
      return NextResponse.json(
        { error: `Payload too large (${contentLength} > ${maxBytes} bytes)` },
        { status: 413 }
      );
    }

    if (validateShape) {
      try {
        const cloned = req.clone();
        const body = await cloned.json();
        const err = validateShape(body);
        if (err) {
          return NextResponse.json({ error: `Invalid payload: ${err}` }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
      }
    }

    return handler(req);
  };
}

// Pre-built validator for Gmail Pub/Sub webhook payloads
export function validatePubSubShape(body: any): string | null {
  if (!body || typeof body !== "object") return "Expected JSON object";
  if (!body.message || typeof body.message !== "object") return "Missing message field";
  if (typeof body.message.data !== "string") return "Missing message.data string";
  if (body.message.data.length > 4096) return "message.data too large";
  return null;
}
