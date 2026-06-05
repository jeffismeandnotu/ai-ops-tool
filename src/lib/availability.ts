import { neon } from "@neondatabase/serverless";
import { BUSINESS } from "@/config/business";
import { getService } from "@/lib/catalog";

// ============================================================
// AVAILABILITY — derived, never stored, never guessed
// ============================================================
// Source of truth is the `bookings` table. The model cannot
// invent a free slot; it calls getAvailability and may only
// offer what this function returns. Calendar is a write-through
// mirror, not consulted here.
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface Slot {
  start: string; // HH:MM (local, business timezone)
  end: string;
  label: string;
}

export interface AvailabilityResult {
  ok: boolean;
  reason?: string;
  date: string;
  serviceId: string;
  durationMinutes?: number;
  slots: Slot[];
}

// Is a specific start time actually free for this service on this date?
export async function isSlotFree(
  date: string,
  serviceId: string,
  startTime: string
): Promise<{ free: boolean; reason?: string }> {
  const svc = getService(serviceId);
  if (!svc) return { free: false, reason: `Unknown service_id '${serviceId}'` };

  const open = toMin(BUSINESS.calendar.workingHours.start);
  const close = toMin(BUSINESS.calendar.workingHours.end);
  const buf = BUSINESS.calendar.bufferMinutes;
  const start = toMin(startTime);
  const end = start + svc.duration;

  const wd = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  if (!BUSINESS.calendar.workingDays.includes(wd))
    return { free: false, reason: `${wd} is not a working day` };
  if (start < open || end > close)
    return { free: false, reason: "Outside working hours" };

  const sql = getDb();
  const rows = await sql`SELECT time, duration FROM bookings WHERE date = ${date} AND status != 'cancelled'`;
  for (const r of rows as any[]) {
    const bs = toMin(String(r.time).slice(0, 5));
    const be = bs + Number(r.duration) + buf;
    // overlap if the requested [start,end) intersects [bs, be)
    if (start < be && end > bs)
      return { free: false, reason: `Overlaps an existing booking at ${toHHMM(bs)}` };
  }
  return { free: true };
}

// Free slots for a service on a date (gap starts within working hours).
export async function getAvailability(
  date: string,
  serviceId: string
): Promise<AvailabilityResult> {
  const svc = getService(serviceId);
  if (!svc)
    return { ok: false, reason: `Unknown service_id '${serviceId}'`, date, serviceId, slots: [] };

  const wd = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  if (!BUSINESS.calendar.workingDays.includes(wd))
    return { ok: true, reason: `${wd} is not a working day`, date, serviceId, durationMinutes: svc.duration, slots: [] };

  const open = toMin(BUSINESS.calendar.workingHours.start);
  const close = toMin(BUSINESS.calendar.workingHours.end);
  const buf = BUSINESS.calendar.bufferMinutes;
  const need = svc.duration;

  const sql = getDb();
  const rows = await sql`SELECT time, duration FROM bookings WHERE date = ${date} AND status != 'cancelled'`;
  const occ = (rows as any[])
    .map((r) => {
      const s = toMin(String(r.time).slice(0, 5));
      return { s, e: s + Number(r.duration) + buf };
    })
    .sort((a, b) => a.s - b.s);

  const mk = (startMin: number): Slot => ({
    start: toHHMM(startMin),
    end: toHHMM(startMin + need),
    label: `${date} ${toHHMM(startMin)}`,
  });

  const slots: Slot[] = [];
  let cursor = open;
  for (const o of occ) {
    if (o.s - cursor >= need) slots.push(mk(cursor));
    cursor = Math.max(cursor, o.e);
  }
  if (close - cursor >= need) slots.push(mk(cursor));

  return { ok: true, date, serviceId, durationMinutes: svc.duration, slots: slots.slice(0, 6) };
}
