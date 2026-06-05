import { BUSINESS } from "@/config/business";

// ============================================================
// TEMPLATES — facts are code-assembled, voice is a thin slot
// ============================================================
// The model passes structured fields; these functions build the
// factual body. A short AI "voice" line is allowed but every hard
// fact (price, date, time, address, name) comes from data here.
// validateOutboundFacts is the backstop: it blocks any send whose
// dollar amounts don't match the record.
// ============================================================

// --- Display helpers (cosmetic only — after validation) ---

function prettySlot(label: string): string {
  const m = String(label).match(/(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})/);
  if (!m) return label;
  const [, y, mo, d, hh, mi] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, 12, 0, 0));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const monthDay = dt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  let h = +hh;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${weekday}, ${monthDay} at ${h}:${mi} ${ampm}`;
}

function prettyTime(hhmm: string): string {
  const m = String(hhmm).match(/(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  let h = +m[1];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

function prettyDate(iso: string): string {
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const monthDay = dt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${weekday}, ${monthDay}`;
}

// --- Variation engine ---

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function greeting(first?: string): string {
  const withName = [`Hi ${first},`, `Hello ${first},`, `Good day ${first},`];
  const noName = ["Hello,", "Hi there,", "Good day,"];
  return first && first.trim() ? pick(withName) : pick(noName);
}

function signoff(): string {
  return pick([
    "Kind regards,\nThe Glow Cleaning Team",
    "Warm regards,\nThe Glow Cleaning Team",
    "Best regards,\nThe Glow Cleaning Team",
    "Thank you,\nThe Glow Cleaning Team",
  ]);
}

// --- Money formatting ---

function fmtMoney(n: number): string {
  return `$${Number(n).toFixed(0)}`;
}

// --- Templates ---

export function servicesListEmail(o: {
  firstName?: string;
  serviceIds?: string[];
}): { subject: string; body: string } {
  const opener = pick([
    "Thank you for reaching out.",
    "Thank you for your inquiry.",
    "We appreciate you getting in touch.",
    "Thank you for contacting us.",
  ]);
  const defaultIds = ["regular", "deep", "moveout"];
  const ids = o.serviceIds?.length ? o.serviceIds : defaultIds;
  const services = ids
    .map((id) => BUSINESS.services.find((s) => s.id === id))
    .filter(Boolean) as typeof BUSINESS.services;
  const lines = services.map(
    (s) => `  • ${s.name} — ${fmtMoney(s.price)} — ${s.short}`
  );
  const closer = pick([
    "How many bedrooms and bathrooms, and is this a one-time clean or something recurring?",
    "Roughly how big is the space, and is it a one-off or regular service?",
    "Could you tell me a bit about the space and whether you're looking for a one-time or ongoing clean?",
  ]);
  const intro = ids === defaultIds
    ? "Here are a few of our most popular services:"
    : "Based on what you described, these services would be the best fit:";
  const body = [
    greeting(o.firstName),
    opener,
    `${intro}\n`,
    lines.join("\n"),
    "",
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: "Our services — Glow Cleaning", body };
}

export function quoteEmail(o: {
  firstName?: string;
  serviceName: string;
  price: number;
  description: string;
  slots: { label: string }[];
  offerContract?: boolean;
  voice?: string;
}): { subject: string; body: string } {
  const opener = pick([
    "Thank you for your interest in our services.",
    "We appreciate you reaching out.",
    "Thank you for contacting us.",
  ]);
  const contract =
    o.offerContract && BUSINESS.pricing?.contract?.enabled
      ? BUSINESS.pricing.contract.line
      : "";

  let slotBlock = "";
  let closer: string;

  if (o.slots.length) {
    const slotIntro = pick([
      "The following times are available:",
      "We have these openings available:",
      "Here are the available time slots:",
    ]);
    const slotLines = o.slots.slice(0, 3).map((s) => `  • ${prettySlot(s.label)}`).join("\n");
    slotBlock = `${slotIntro}\n${slotLines}`;
    closer = pick([
      "Please reply with your preferred time and we will confirm your booking.",
      "Let us know which time works best and we will get it scheduled.",
      "Reply with your choice and we will reserve it for you.",
    ]);
  } else {
    closer = pick([
      "Just let me know which day and time would suit you, and I will check availability and confirm.",
      "When would work best for you? Send me a preferred day and time and I will confirm availability.",
      "Let me know the day and time you would prefer and I will get it confirmed.",
    ]);
  }

  const body = [
    greeting(o.firstName),
    opener,
    `For a ${o.serviceName}, the price is ${fmtMoney(o.price)}. That covers ${o.description}`,
    contract,
    slotBlock,
    closer,
    signoff(),
  ].filter(Boolean).join("\n\n");
  return { subject: `${o.serviceName} quote`, body };
}

export function availabilityEmail(o: {
  firstName?: string;
  days: { date: string; weekday: string; slots: string[] }[];
}): { subject: string; body: string } {
  const opener = pick([
    "Here is our availability over the next few days:",
    "Below are the times we currently have open:",
    "Here is what we have available:",
  ]);
  const dayBlocks = o.days
    .map((d) => {
      const header = `${d.weekday}, ${prettyDate(d.date).split(", ").pop()}`;
      const lines = d.slots.map((s) => `    • ${prettySlot(s)}`).join("\n");
      return `  ${header}\n${lines}`;
    })
    .join("\n\n");
  const closer = pick([
    "Please let us know which time works best and we will confirm your booking.",
    "Reply with your preferred time and we will get it scheduled.",
    "Let us know which suits you and we will reserve it.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    dayBlocks,
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: "Available times — Glow Cleaning", body };
}

export function bookingConfirmation(o: {
  firstName?: string;
  serviceName: string;
  date: string;
  start: string;
  end: string;
  address: string;
  cleaner?: string;
  price: number;
  duration: number;
}): { subject: string; body: string } {
  const opener = pick([
    "Your booking has been confirmed. Here are the details:",
    "Your appointment is confirmed — details below.",
    "We have confirmed your booking. Please review the details below.",
  ]);
  const closer = pick([
    "If you have any special instructions or need to make changes, please reply to this email.",
    "Should anything change, please reply and we will update your booking.",
    "Please reply if you have any questions or need to adjust anything.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    `  • Service: ${o.serviceName}\n  • Date: ${prettyDate(o.date)}\n  • Time: ${prettyTime(o.start)}–${prettyTime(o.end)}\n  • Address: ${o.address}${o.cleaner ? `\n  • Cleaner: ${o.cleaner}` : ""}\n  • Duration: ${o.duration} min\n  • Price: ${fmtMoney(o.price)}`,
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: `Booking confirmed — ${o.serviceName} on ${o.date}`, body };
}

export function missingInfoEmail(o: {
  firstName?: string;
  missing: string[];
  voice?: string;
}): { subject: string; body: string } {
  const opener = pick([
    "Thank you for your inquiry.",
    "We would be happy to help.",
    "Thank you for reaching out.",
  ]);
  const askIntro = pick([
    "To proceed, we need the following:",
    "Before we can book, could you provide:",
    "We just need a couple of details:",
  ]);
  const human: Record<string, string> = {
    address: "the service address",
    date: "your preferred date",
    startTime: "a preferred time",
    service: "which service you'd like",
    name: "your name",
  };
  const asks = o.missing.map((m) => human[m] || m).join(", ");
  const body = [
    greeting(o.firstName),
    opener,
    `${askIntro} ${asks}. Once we have that, we can proceed with your booking.`,
    signoff(),
  ].join("\n\n");
  return { subject: "A couple of details needed to complete your booking", body };
}

export function rescheduleConfirmation(o: {
  firstName?: string;
  serviceName: string;
  newDate: string;
  start: string;
  end: string;
}): { subject: string; body: string } {
  const opener = pick([
    `Your appointment has been rescheduled to ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
    `We have updated your booking to ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
    `Your new time is confirmed: ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
  ]);
  const closer = pick([
    "If you need any further changes, please reply to this email.",
    "Please do not hesitate to reach out if anything else needs adjusting.",
    "Should you need to make additional changes, simply reply.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: `Rescheduled — ${o.serviceName} on ${o.newDate}`, body };
}

export function cancellationConfirmation(o: {
  firstName?: string;
  serviceName: string;
  date: string;
}): { subject: string; body: string } {
  const opener = pick([
    "This is to confirm that",
    "We have processed your request —",
    "Your cancellation has been confirmed —",
  ]);
  const closer = pick([
    "We would be glad to assist you whenever you are ready to rebook — simply reply to this email.",
    "Whenever you would like to reschedule, please reply and we will arrange it.",
    "We look forward to working with you again. Please reply any time to rebook.",
  ]);
  const body = [
    greeting(o.firstName),
    `${opener} your ${o.serviceName} on ${prettyDate(o.date)} has been cancelled. No charge.`,
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: `Cancelled — ${o.serviceName} on ${o.date}`, body };
}

export function reminderEmail(o: {
  firstName?: string;
  serviceName: string;
  date: string;
  start: string;
  address: string;
  noticeHours: number;
}): { subject: string; body: string } {
  const opener = pick([
    "This is a reminder about your upcoming appointment.",
    "A friendly reminder that your cleaning is coming up.",
    "We wanted to confirm the details of your upcoming appointment.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    `  • Date: ${prettyDate(o.date)}\n  • Time: ${prettyTime(o.start)}\n  • Address: ${o.address}`,
    `If you need to reschedule or cancel, please reply to this email at least ${o.noticeHours} hours before — changes within ${o.noticeHours} hours may be subject to a fee.`,
    signoff(),
  ].join("\n\n");
  return { subject: `Reminder — ${o.serviceName} on ${o.date}`, body };
}

export function waitlistOpening(o: {
  firstName?: string;
  serviceName: string;
  date: string;
}): { subject: string; body: string } {
  const opener = pick([
    "An opening has become available.",
    "A time slot has opened up.",
    "We have availability that may interest you.",
  ]);
  const closer = pick([
    "If you would like to book this slot, please reply at your earliest convenience — availability is on a first-come, first-served basis.",
    "Please reply if you would like us to reserve this for you. Availability is first come, first served.",
    "Let us know if this works for you and we will confirm the booking. First come, first served.",
  ]);
  const body = [
    greeting(o.firstName),
    `${opener} A ${o.serviceName} on ${prettyDate(o.date)} is now available.`,
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: `A spot opened up — ${o.serviceName} on ${o.date}`, body };
}

export function cancellationFeeNotice(o: {
  firstName?: string;
  serviceName: string;
  date: string;
  feeLine: string;
}): { subject: string; body: string } {
  const opener = pick([
    `Thank you for letting us know about your ${o.serviceName} on ${prettyDate(o.date)}.`,
    `We have received your cancellation request for your ${o.serviceName} on ${prettyDate(o.date)}.`,
  ]);
  const closer = pick([
    "A member of our team will follow up with you shortly.",
    "Someone from our team will be in touch shortly to discuss next steps.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    o.feeLine,
    closer,
    signoff(),
  ].join("\n\n");
  return { subject: `Cancellation request — ${o.serviceName} on ${o.date}`, body };
}

// ============================================================
// PRE-SEND VALIDATOR — the fact backstop
// ============================================================
// Extracts every dollar amount in the draft and checks it against
// the set of prices the underlying record allows. Any amount not in
// the allowed set blocks the send.
export function validateOutboundFacts(
  body: string,
  allowedPrices: number[]
): { ok: boolean; violations: string[] } {
  const allowed = new Set(allowedPrices.map((p) => Math.round(Number(p))));
  const violations: string[] = [];
  const matches = body.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || [];
  for (const m of matches) {
    const n = Math.round(Number(m.replace(/[^\d.]/g, "")));
    if (!allowed.has(n)) {
      violations.push(`Draft contains ${m} which is not an allowed price (${allowedPrices.map(fmtMoney).join(", ") || "none"})`);
    }
  }
  return { ok: violations.length === 0, violations };
}
