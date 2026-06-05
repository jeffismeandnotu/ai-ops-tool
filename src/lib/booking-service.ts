import { neon } from "@neondatabase/serverless";
import { BUSINESS } from "@/config/business";
import { requireService } from "@/lib/catalog";
import { isSlotFree, getAvailability } from "@/lib/availability";
import { createBooking, updateBookingFields, getRemindableBookings, markReminderSent } from "@/lib/clients-db";
import * as calendar from "@/lib/calendar";
import { reminderEmail } from "@/lib/templates";
import { sendEmail } from "@/lib/gmail";

// Convert a wall-clock date+time in a named IANA timezone to a UTC epoch (ms),
// DST-correct. e.g. ("2026-06-05","08:00","America/Vancouver") -> the ms for 15:00Z.
function zonedWallClockToUtcMs(dateStr: string, timeStr: string, tz: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(guess)).reduce((a: any, p) => ((a[p.type] = p.value), a), {});
  const tzWallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = tzWallAsUtc - guess;
  return guess - offset;
}

// ============================================================
// BOOKING SERVICE — the only path that writes a booking
// ============================================================
// Guarantees, enforced in code (not by the model):
//  - price + duration come from the catalog, never from input
//  - the slot is re-checked free at write time (no double-booking)
//  - the DB row is the source of truth; Calendar is written through
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

interface BookingInput {
  clientId: string;
  clientEmail?: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM (business local time)
  address: string;
  clientName?: string;
  employeeName?: string;
  employeeEmail?: string;
  notes?: string;
}

export async function createBookingGuarded(
  accessToken: string,
  input: BookingInput
): Promise<
  | { ok: true; bookingId: string; calendarEventId: string | null; service: { name: string; price: number; duration: number }; start: string; end: string }
  | { ok: false; reason: string; alternatives?: { start: string; end: string }[] }
> {
  // 1. Service + price from catalog (throws on unknown id).
  const svc = requireService(input.serviceId);

  // 2. Required fields.
  const missing: string[] = [];
  if (!input.clientId) missing.push("clientId");
  if (!input.date) missing.push("date");
  if (!input.startTime) missing.push("startTime");
  if (!input.address) missing.push("address");
  if (missing.length) return { ok: false, reason: `Missing required fields: ${missing.join(", ")}` };

  // 3. Re-check the slot is actually free right now.
  const free = await isSlotFree(input.date, input.serviceId, input.startTime);
  if (!free.free) {
    const avail = await getAvailability(input.date, input.serviceId);
    return {
      ok: false,
      reason: free.reason || "Slot unavailable",
      alternatives: avail.slots.slice(0, 3).map((s) => ({ start: s.start, end: s.end })),
    };
  }

  const endTime = toHHMM(toMin(input.startTime) + svc.duration);

  // 4. DB first (source of truth) — price/duration from catalog.
  const booking = await createBooking({
    clientId: input.clientId,
    serviceId: svc.id,
    serviceName: svc.name,
    price: svc.price,
    date: input.date,
    time: input.startTime,
    duration: svc.duration,
    address: input.address,
    employeeName: input.employeeName,
    employeeEmail: input.employeeEmail,
    notes: input.notes,
  });

  // 5. Write through to Calendar (mirror). DB stays authoritative on failure.
  let calendarEventId: string | null = null;
  try {
    const attendees = [input.clientEmail, input.employeeEmail].filter(Boolean) as string[];
    const ev = await calendar.createEvent(accessToken, {
      summary: `${svc.name} — ${input.clientName || "Client"}`,
      description: `Service: ${svc.name}\nPrice: $${svc.price} ${BUSINESS.currency}\nDuration: ${svc.duration} min\nAddress: ${input.address}${input.notes ? `\nNotes: ${input.notes}` : ""}`,
      location: input.address,
      startTime: `${input.date}T${input.startTime}:00`,
      endTime: `${input.date}T${endTime}:00`,
      attendeeEmails: attendees.length ? attendees : undefined,
      colorId: BUSINESS.calendar.colorCodes?.[svc.id],
      reminders: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 30 }],
    });
    calendarEventId = ev.id || null;
    if (calendarEventId) {
      const sql = getDb();
      await sql`UPDATE bookings SET calendar_event_id = ${calendarEventId}, updated_at = NOW() WHERE id = ${booking.id}`;
    }
  } catch (e: any) {
    console.error("calendar write-through failed (booking kept in DB):", e?.message || e);
  }

  return {
    ok: true,
    bookingId: booking.id,
    calendarEventId,
    service: { name: svc.name, price: svc.price, duration: svc.duration },
    start: input.startTime,
    end: endTime,
  };
}

// --- Reschedule (by booking id) ---
export async function rescheduleGuarded(
  accessToken: string,
  bookingId: string,
  newDate: string,
  newStartTime: string
): Promise<{ ok: true; start: string; end: string } | { ok: false; reason: string; alternatives?: { start: string; end: string }[] }> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM bookings WHERE id = ${bookingId} LIMIT 1`;
  if (!rows.length) return { ok: false, reason: `Booking ${bookingId} not found` };
  const b = rows[0] as any;
  const svc = requireService(b.service_id);

  // Free check excluding this booking itself.
  const open = toMin(BUSINESS.calendar.workingHours.start);
  const close = toMin(BUSINESS.calendar.workingHours.end);
  const buf = BUSINESS.calendar.bufferMinutes;
  const start = toMin(newStartTime);
  const end = start + svc.duration;
  if (start < open || end > close) return { ok: false, reason: "Outside working hours" };
  const others = await sql`SELECT time, duration FROM bookings WHERE date = ${newDate} AND status != 'cancelled' AND id != ${bookingId}`;
  for (const r of others as any[]) {
    const bs = toMin(String(r.time).slice(0, 5));
    const be = bs + Number(r.duration) + buf;
    if (start < be && end > bs) {
      const avail = await getAvailability(newDate, b.service_id);
      return { ok: false, reason: "Requested time overlaps an existing booking", alternatives: avail.slots.slice(0, 3).map((s) => ({ start: s.start, end: s.end })) };
    }
  }

  const endTime = toHHMM(end);
  await sql`UPDATE bookings SET date = ${newDate}, time = ${newStartTime}, updated_at = NOW() WHERE id = ${bookingId}`;
  if (b.calendar_event_id) {
    try {
      await calendar.updateEvent(accessToken, b.calendar_event_id, {
        startTime: `${newDate}T${newStartTime}:00`,
        endTime: `${newDate}T${endTime}:00`,
      });
    } catch (e: any) {
      console.error("calendar reschedule mirror failed:", e?.message || e);
    }
  }
  return { ok: true, start: newStartTime, end: endTime };
}

// --- Cancel (by booking id) ---
export async function cancelGuarded(
  accessToken: string,
  bookingId: string,
  reason?: string
): Promise<{ ok: boolean; reason?: string; feeApplies?: boolean; hoursUntil?: number; booking?: any }> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM bookings WHERE id = ${bookingId} LIMIT 1`;
  if (!rows.length) return { ok: false, reason: `Booking ${bookingId} not found` };
  const b = rows[0] as any;

  // Notice-window policy: within N hours of the appointment, the AI does NOT
  // cancel — a fee applies and the owner handles it.
  const apptDate = String(b.date).slice(0, 10);
  const apptTime = String(b.time).slice(0, 5);
  const appt = new Date(zonedWallClockToUtcMs(apptDate, apptTime, BUSINESS.timezone));
  const hoursUntil = (appt.getTime() - Date.now()) / 3_600_000;
  const noticeHours = BUSINESS.cancellation?.noticeHours ?? 24;
  if (hoursUntil < noticeHours) {
    return { ok: false, feeApplies: true, hoursUntil, booking: b };
  }

  await sql`UPDATE bookings SET status = 'cancelled', cancel_reason = ${reason || null}, updated_at = NOW() WHERE id = ${bookingId}`;
  if (b.calendar_event_id) {
    try {
      await calendar.deleteEvent(accessToken, b.calendar_event_id);
    } catch (e: any) {
      console.error("calendar cancel mirror failed:", e?.message || e);
    }
  }
  return { ok: true, booking: b };
}

// ============================================================
// POST-BOOKING UPDATE — change editable details (address/notes)
// ============================================================
export async function updateBookingDetails(
  accessToken: string,
  bookingId: string,
  fields: { address?: string; notes?: string }
): Promise<{ ok: boolean; booking?: any; reason?: string }> {
  const b = await updateBookingFields(bookingId, fields);
  if (!b) return { ok: false, reason: `Booking ${bookingId} not found` };
  // Mirror to the calendar event (location/description).
  if ((b as any).calendar_event_id) {
    try {
      await calendar.updateEvent(accessToken, (b as any).calendar_event_id, {
        location: (b as any).address,
        description: (b as any).notes || undefined,
      });
    } catch (e: any) {
      console.error("calendar update mirror failed:", e?.message || e);
    }
  }
  return { ok: true, booking: b };
}

// ============================================================
// REMINDERS — send a one-time reminder for upcoming bookings
// ============================================================
// Sends to confirmed, not-yet-reminded bookings within 48h, so the
// client still has room to cancel/reschedule before the notice cutoff.
export async function sendDueReminders(
  accessToken: string
): Promise<{ checked: number; sent: number; details: string[] }> {
  const candidates = await getRemindableBookings();
  const now = Date.now();
  const notice = BUSINESS.cancellation?.noticeHours ?? 24;
  let sent = 0;
  const details: string[] = [];
  for (const b of candidates) {
    const date = String((b as any).date).slice(0, 10);
    const time = String((b as any).time).slice(0, 5);
    const apptUtc = zonedWallClockToUtcMs(date, time, BUSINESS.timezone);
    const hoursUntil = (apptUtc - now) / 3_600_000;
    if (hoursUntil <= 0 || hoursUntil > 48) continue;
    const first = ((b as any).client_name || "").split(/\s+/)[0] || undefined;
    const mail = reminderEmail({
      firstName: first,
      serviceName: (b as any).service_name,
      date,
      start: time,
      address: (b as any).address,
      noticeHours: notice,
    });
    try {
      await sendEmail(accessToken, [(b as any).client_email], mail.subject, mail.body);
      await markReminderSent((b as any).id);
      sent++;
      details.push(`${(b as any).id} -> ${(b as any).client_email} (${Math.round(hoursUntil)}h)`);
    } catch (e: any) {
      details.push(`${(b as any).id} FAILED: ${e?.message || e}`);
    }
  }
  return { checked: candidates.length, sent, details };
}
