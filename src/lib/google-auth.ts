import { neon } from "@neondatabase/serverless";
import { google } from "googleapis";

// ============================================================
// GOOGLE AUTH STORE — refresh token + Gmail watch state (Neon)
// ============================================================
// Replaces the broken static GOOGLE_ACCESS_TOKEN / token.json flow.
// Access tokens live 1 hour; we persist the long-lived refresh
// token and mint fresh access tokens on demand (googleapis
// auto-refreshes). Watch state tracks the last historyId so the
// webhook only fetches genuinely new messages.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _initialized = false;
async function ensureTables() {
  if (_initialized) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS ai_google_auth (
    email TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ai_gmail_watch (
    email TEXT PRIMARY KEY,
    history_id TEXT,
    expiration TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  _initialized = true;
}

// --- Refresh token ---
export async function saveRefreshToken(email: string, refreshToken: string) {
  if (!email || !refreshToken) return;
  await ensureTables();
  const sql = getDb();
  await sql`INSERT INTO ai_google_auth (email, refresh_token, updated_at)
    VALUES (${email}, ${refreshToken}, NOW())
    ON CONFLICT (email) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = NOW()`;
}

export async function getRefreshToken(email: string): Promise<string | null> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT refresh_token FROM ai_google_auth WHERE email = ${email} LIMIT 1`;
  return rows[0]?.refresh_token || null;
}

// The single mailbox the automation runs on. Configured via env so the
// webhook/cron know whose refresh token to use without a browser session.
export function getOpsEmail(): string {
  return process.env.OPS_GMAIL_ADDRESS || "aryanraman777@gmail.com";
}

// --- Mint a fresh access token from the stored refresh token ---
export async function getFreshAccessToken(email?: string): Promise<string> {
  const addr = email || getOpsEmail();
  const refreshToken = await getRefreshToken(addr);
  if (!refreshToken) {
    throw new Error(
      `No refresh token stored for ${addr}. Sign in once via the app (Production OAuth) to capture it.`
    );
  }
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error(`Failed to refresh access token for ${addr}`);
  return token;
}

// --- Gmail watch state ---
export async function saveWatchState(
  email: string,
  historyId: string,
  expiration?: string | number | null
) {
  await ensureTables();
  const sql = getDb();
  const exp = expiration ? new Date(Number(expiration)).toISOString() : null;
  await sql`INSERT INTO ai_gmail_watch (email, history_id, expiration, updated_at)
    VALUES (${email}, ${historyId}, ${exp}, NOW())
    ON CONFLICT (email) DO UPDATE SET history_id = EXCLUDED.history_id, expiration = EXCLUDED.expiration, updated_at = NOW()`;
}

export async function getLastHistoryId(email: string): Promise<string | null> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT history_id FROM ai_gmail_watch WHERE email = ${email} LIMIT 1`;
  return rows[0]?.history_id || null;
}

export async function getWatchState(
  email: string
): Promise<{ historyId: string | null; expiration: Date | null }> {
  await ensureTables();
  const sql = getDb();
  const rows = await sql`SELECT history_id, expiration FROM ai_gmail_watch WHERE email = ${email} LIMIT 1`;
  if (!rows[0]) return { historyId: null, expiration: null };
  return {
    historyId: rows[0].history_id || null,
    expiration: rows[0].expiration ? new Date(rows[0].expiration) : null,
  };
}
