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
  const withName = [`Hi ${first},`, `Hey ${first},`, `Hello ${first},`, `Hi there ${first},`];
  const noName = ["Hi there,", "Hey there,", "Hello,"];
  return first && first.trim() ? pick(withName) : pick(noName);
}

function signoff(): string {
  return pick([
    "Warmly,\nThe Glow Cleaning team",
    "Talk soon,\nThe Glow Cleaning team",
    "Cheers,\nThe Glow Cleaning team",
    "All the best,\nThe Glow Cleaning team",
    "Thanks so much,\nThe Glow Cleaning team",
  ]);
}

// --- Money formatting ---

function fmtMoney(n: number): string {
  return `$${Number(n).toFixed(0)}`;
}

// --- Templates ---

export function servicesListEmail(o: {
  firstName?: string;
}): { subject: string; body: string } {
  const opener = pick([
    "Thanks for reaching out!",
    "Great to hear from you!",
    "Happy to help you out!",
    "Thanks for thinking of us!",
  ]);
  const lines = BUSINESS.services.map(
    (s) => `  • ${s.name} — ${fmtMoney(s.price)} (${s.duration} min)\n    ${s.description}`
  );
  const closer = pick([
    "Just let me know what you're looking for — the type of space, what needs doing — and I'll suggest the best fit and get you some times.",
    "Tell me a bit about your place and what you need, and I'll recommend the right service and find you some openings.",
    "Reply with what you have in mind and I'll match you up with the right service and available times.",
    "What kind of space are we working with? Let me know and I'll point you to the right service.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    "Here's what we offer:\n",
    lines.join("\n\n"),
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
    "Thanks for thinking of us!",
    "Great to hear from you!",
    "Happy to help you get this booked.",
    "Thanks for reaching out!",
  ]);
  const slotIntro = pick([
    "Here are a couple of times that would work great:",
    "I've got a few openings that could work:",
    "Here are some times I can offer:",
    "A couple of slots that would suit:",
  ]);
  const slotLines = o.slots.slice(0, 3).map((s) => `  • ${prettySlot(s.label)}`).join("\n");
  const contract =
    o.offerContract && BUSINESS.pricing?.contract?.enabled
      ? BUSINESS.pricing.contract.line
      : "";
  const closer = pick([
    "Just reply with the one that suits you and I'll lock it in.",
    "Let me know which works and I'll get it booked.",
    "Reply with your pick and consider it done.",
    "Tell me which time works best and I'll hold it for you.",
  ]);
  const body = [
    greeting(o.firstName),
    opener,
    `For a ${o.serviceName}, the price is ${fmtMoney(o.price)}. That covers ${o.description}`,
    contract,
    o.slots.length ? `${slotIntro}\n${slotLines}` : "",
    closer,
    signoff(),
  ].filter(Boolean).join("\n\n");
  return { subject: `${o.serviceName} quote`, body };
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
    "You're all set — we're looking forward to it!",
    "All booked — we can't wait to get your place sparkling!",
    "You're confirmed — looking forward to it!",
    "Great news — you're booked in!",
  ]);
  const closer = pick([
    "Anything you'd like us to know before we arrive? Just hit reply.",
    "If anything changes, just reply to this email.",
    "Any special instructions? Just reply and let us know.",
    "Need to tweak anything? Just reply and we'll sort it.",
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
    "Happy to help!",
    "Glad to get this going for you!",
    "Let's get you booked in!",
    "Happy to sort this out for you!",
  ]);
  const askIntro = pick([
    "Just one quick thing first:",
    "I just need one quick detail:",
    "Could you help me with one thing:",
    "One small thing and you're set:",
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
    `${askIntro} could you send me ${asks}? Once I have that I'll get you booked.`,
    signoff(),
  ].join("\n\n");
  return { subject: "Quick question before I book you in", body };
}

export function rescheduleConfirmation(o: {
  firstName?: string;
  serviceName: string;
  newDate: string;
  start: string;
  end: string;
}): { subject: string; body: string } {
  const opener = pick([
    `No problem at all — you're now set for ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
    `Done! You're now booked for ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
    `All sorted — your new time is ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
    `Easy — you're rescheduled to ${prettyDate(o.newDate)}, ${prettyTime(o.start)}–${prettyTime(o.end)}.`,
  ]);
  const closer = pick([
    "Anything else you need, just say the word.",
    "Let me know if anything else comes up.",
    "If this changes again, just reply.",
    "See you then!",
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
    "All done —",
    "No problem —",
    "Done —",
    "Taken care of —",
  ]);
  const closer = pick([
    "We'd love to have you back whenever the timing's right — just reply and we'll sort it out.",
    "Whenever you're ready to rebook, just reply.",
    "Hope to see you again soon — reach out anytime.",
    "The door's always open — reply whenever you'd like to rebook.",
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
    "Just a friendly heads-up that we'll see you soon!",
    "Quick reminder — we're on for your cleaning soon!",
    "Looking forward to seeing you soon!",
    "Just popping in with a friendly reminder.",
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
    "Good news — a spot just opened up!",
    "Great news — a spot has opened up!",
    "You're in luck — a spot just freed up!",
  ]);
  const closer = pick([
    "Reply and I'll hold it for you — first come, first served, so let me know soon.",
    "Want it? Just reply and it's yours — first come, first served.",
    "Reply to grab it — it's first come, first served, so don't wait too long.",
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
    `Thanks for letting us know about your ${o.serviceName} on ${prettyDate(o.date)}.`,
    `Thanks for the heads-up about your ${o.serviceName} on ${prettyDate(o.date)}.`,
  ]);
  const closer = pick([
    "Someone from our team will reach out shortly.",
    "Someone from our team will be in touch shortly.",
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
