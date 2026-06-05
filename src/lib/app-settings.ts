import { neon } from "@neondatabase/serverless";

// ============================================================
// APP SETTINGS — small persistent key/value store (Neon)
// ============================================================
// Used for the dashboard Start/Stop switch. Default is OFF:
// email processing only runs when the owner explicitly starts it.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensure() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz DEFAULT now()
  )`;
  _init = true;
}

export async function getAutomationEnabled(): Promise<boolean> {
  await ensure();
  const sql = getDb();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'automation_enabled' LIMIT 1`;
  if (!rows.length) return false; // default OFF
  return rows[0].value === "true";
}

export async function setAutomationEnabled(enabled: boolean): Promise<void> {
  await ensure();
  const sql = getDb();
  await sql`INSERT INTO app_settings (key, value, updated_at)
    VALUES ('automation_enabled', ${enabled ? "true" : "false"}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
