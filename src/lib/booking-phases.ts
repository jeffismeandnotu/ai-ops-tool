import { neon } from "@neondatabase/serverless";

// ============================================================
// BOOKING PHASES — persisted 3-phase state machine per thread
// ============================================================
// Each email thread (the "instance") moves through three phases.
// A phase must be completed and marked before the next can begin.
//   0  nothing yet
//   1  TALK done    — responded + asked to go ahead with booking
//   2  CONFIRM done — client confirmed; details verified
//   3  BOOK done    — booking created, confirmation sent, calendar updated
// phase1_msg records WHICH inbound reached phase 1, so the confirmation
// (phase 2) can only be a *later* message — never the same one.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

let _init = false;
async function ensure() {
  if (_init) return;
  const sql = getDb();
  await sql`CREATE TABLE IF NOT EXISTS booking_phases (
    thread_id text PRIMARY KEY,
    phase int NOT NULL DEFAULT 0,
    phase1_msg text,
    updated_at timestamptz DEFAULT now()
  )`;
  _init = true;
}

export interface PhaseState {
  phase: number;
  phase1Msg: string | null;
}

export async function getPhase(threadId: string): Promise<PhaseState> {
  await ensure();
  const sql = getDb();
  const rows = await sql`SELECT phase, phase1_msg FROM booking_phases WHERE thread_id = ${threadId} LIMIT 1`;
  if (!rows.length) return { phase: 0, phase1Msg: null };
  return { phase: Number(rows[0].phase) || 0, phase1Msg: rows[0].phase1_msg || null };
}

// Set the phase. When advancing to phase 1, records the message that did it.
export async function setPhase(threadId: string, phase: number, phase1Msg?: string): Promise<void> {
  await ensure();
  const sql = getDb();
  if (phase === 1 && phase1Msg) {
    await sql`INSERT INTO booking_phases (thread_id, phase, phase1_msg, updated_at)
      VALUES (${threadId}, 1, ${phase1Msg}, now())
      ON CONFLICT (thread_id) DO UPDATE SET phase = 1, phase1_msg = ${phase1Msg}, updated_at = now()`;
  } else {
    await sql`INSERT INTO booking_phases (thread_id, phase, updated_at)
      VALUES (${threadId}, ${phase}, now())
      ON CONFLICT (thread_id) DO UPDATE SET phase = ${phase}, updated_at = now()`;
  }
}

export async function resetPhase(threadId: string): Promise<void> {
  await ensure();
  const sql = getDb();
  await sql`DELETE FROM booking_phases WHERE thread_id = ${threadId}`;
}
