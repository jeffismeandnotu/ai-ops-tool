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

const SIGNOFF = BUSINESS.administrator.signOff;

function fmtMoney(n: number): string {
  return `$${Number(n).toFixed(0)}`;
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
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const slotLines = o.slots.slice(0, 3).map((s) => `  • ${s.label}`).join("\n");
  const contract =
    o.offerContract && BUSINESS.pricing?.contract?.enabled
      ? BUSINESS.pricing.contract.line
      : "";
  const body = [
    greeting,
    o.voice?.trim() || "",
    `For a ${o.serviceName}, the price is ${fmtMoney(o.price)}. That covers ${o.description}`,
    contract,
    o.slots.length ? `I can fit you in at one of these times:\n${slotLines}` : "",
    "Just reply with what works and I'll lock it in.",
    SIGNOFF,
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
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const body = [
    greeting,
    `You're booked. Here are the details:`,
    `  • Service: ${o.serviceName}\n  • Date: ${o.date}\n  • Time: ${o.start}–${o.end}\n  • Address: ${o.address}${o.cleaner ? `\n  • Cleaner: ${o.cleaner}` : ""}\n  • Duration: ${o.duration} min\n  • Price: ${fmtMoney(o.price)}`,
    "If you need to make any changes, just reply to this email.",
    SIGNOFF,
  ].join("\n\n");
  return { subject: `Booking confirmed — ${o.serviceName} on ${o.date}`, body };
}

export function missingInfoEmail(o: {
  firstName?: string;
  missing: string[];
  voice?: string;
}): { subject: string; body: string } {
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const human: Record<string, string> = {
    address: "the service address",
    date: "your preferred date",
    startTime: "a preferred time",
    service: "which service you'd like",
    name: "your name",
  };
  const asks = o.missing.map((m) => human[m] || m).join(", ");
  const body = [
    greeting,
    o.voice?.trim() || `Happy to help — I just need a couple of details first.`,
    `Could you send me ${asks}? Once I have that I'll get you booked.`,
    SIGNOFF,
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
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const body = [
    greeting,
    `Done — your ${o.serviceName} is now ${o.newDate}, ${o.start}–${o.end}.`,
    "If you need to make any changes, just reply to this email.",
    SIGNOFF,
  ].join("\n\n");
  return { subject: `Rescheduled — ${o.serviceName} on ${o.newDate}`, body };
}

export function cancellationConfirmation(o: {
  firstName?: string;
  serviceName: string;
  date: string;
}): { subject: string; body: string } {
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const body = [
    greeting,
    `Your ${o.serviceName} on ${o.date} has been cancelled. No charge.`,
    "If you'd like to rebook, just let me know.",
    SIGNOFF,
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
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const body = [
    greeting,
    `A quick reminder of your upcoming ${o.serviceName}:`,
    `  • Date: ${o.date}\n  • Time: ${o.start}\n  • Address: ${o.address}`,
    `If you need to reschedule or cancel, please reply to this email at least ${o.noticeHours} hours before — changes within ${o.noticeHours} hours may be subject to a fee.`,
    SIGNOFF,
  ].join("\n\n");
  return { subject: `Reminder — ${o.serviceName} on ${o.date}`, body };
}

export function waitlistOpening(o: {
  firstName?: string;
  serviceName: string;
  date: string;
}): { subject: string; body: string } {
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const body = [
    greeting,
    `Good news — a spot has opened up for a ${o.serviceName} on ${o.date}, which you'd asked about.`,
    "Reply to this email and I'll hold it for you. It's first come, first served, so let me know soon if you'd like it.",
    SIGNOFF,
  ].join("\n\n");
  return { subject: `A spot opened up — ${o.serviceName} on ${o.date}`, body };
}

export function cancellationFeeNotice(o: {
  firstName?: string;
  serviceName: string;
  date: string;
  feeLine: string;
}): { subject: string; body: string } {
  const greeting = o.firstName ? `Hi ${o.firstName},` : "Hi,";
  const body = [
    greeting,
    `Thanks for letting me know about your ${o.serviceName} on ${o.date}.`,
    o.feeLine,
    SIGNOFF,
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
