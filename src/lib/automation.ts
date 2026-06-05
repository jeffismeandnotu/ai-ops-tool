// ============================================================
// AUTONOMOUS WORKFLOW ENGINE
// ============================================================
// This runs on a cron schedule (every 5 minutes).
// No human in the loop. The AI:
//   1. Reads new emails
//   2. Classifies each one
//   3. Executes the appropriate workflow
//   4. Logs everything to ops file
//   5. Verifies before acting
//
// STEP-BY-STEP AI PROCESSING PROTOCOL:
//
// STEP 1: READ OPS LOG
//   - Load data/operations.json and data/processed_emails.json
//   - Know what has already been handled
//   - Prevent duplicate processing
//
// STEP 2: FETCH NEW EMAILS
//   - Query Gmail for unread emails in inbox
//   - Filter out already-processed message IDs
//   - If no new emails → exit cycle, log "no new emails"
//
// STEP 3: CLASSIFY EACH EMAIL
//   For each new email, determine type:
//   - BOOKING_REQUEST: client wants to schedule a service
//   - RESCHEDULE: client wants to change existing booking
//   - CANCELLATION: client wants to cancel
//   - INQUIRY: client asking about services/pricing/availability
//   - COMPLAINT: client unhappy with service
//   - EMPLOYEE_INTERNAL: employee communication (schedule, availability)
//   - CONFIRMATION_REPLY: reply to a confirmation we sent
//   - SPAM_IRRELEVANT: not business-related
//   Log classification to ops log.
//
// STEP 4: EXECUTE WORKFLOW (per classification)
//
//   BOOKING_REQUEST:
//     a. Extract: client name, email, phone, address, service type,
//        preferred date/time, any special requests
//     b. VERIFY: are all required fields present?
//        - Missing info → draft email requesting details, log, mark processed
//     c. CHECK CALENDAR: find available slots on requested date
//        - No availability → draft email with alternative times
//     d. CREATE BOOKING: calendar event with all details
//     e. SEND CONFIRMATION: email to client with date, time, address,
//        cleaner name, price, duration
//     f. NOTIFY EMPLOYEE: email to assigned cleaner with job details
//     g. LOG: all actions to ops log with event IDs and email IDs
//
//   RESCHEDULE:
//     a. Find existing booking (search calendar by client name/email)
//     b. Extract new requested date/time
//     c. VERIFY: new slot available?
//     d. UPDATE calendar event
//     e. SEND updated confirmation to client
//     f. NOTIFY employee of change
//     g. LOG
//
//   CANCELLATION:
//     a. Find existing booking
//     b. DELETE calendar event
//     c. SEND cancellation confirmation to client
//     d. NOTIFY employee
//     e. LOG
//
//   INQUIRY:
//     a. Determine what they're asking about
//     b. DRAFT response with relevant info (services, prices, availability)
//     c. SEND response
//     d. LOG
//
//   COMPLAINT:
//     a. DO NOT auto-respond
//     b. FORWARD to manager/owner with summary
//     c. DRAFT a professional acknowledgment for manager review
//     d. LOG as requiring human attention
//
//   EMPLOYEE_INTERNAL:
//     a. If availability change → update employee record
//     b. If schedule question → respond with their upcoming bookings
//     c. LOG
//
//   CONFIRMATION_REPLY:
//     a. If "confirmed" / "thanks" → mark as acknowledged, no action
//     b. If contains questions → treat as inquiry
//     c. LOG
//
//   SPAM_IRRELEVANT:
//     a. Archive email
//     b. LOG as skipped
//
// STEP 5: VERIFY & CLOSE
//   - Re-read ops log
//   - Confirm all actions were recorded
//   - Mark email as processed in processed_emails.json
//   - Label email in Gmail (PROCESSED, NEEDS_ATTENTION, etc.)
//
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { llm, AI_MODEL, toOpenAITools } from "@/lib/llm";
import { BUSINESS } from "@/config/business";
import * as gmail from "@/lib/gmail";
import * as calendar from "@/lib/calendar";
import {
  appendOperation,
  isEmailProcessed,
  markEmailProcessed,
  claimEmail,
  getOpsLogSummary,
  readOpsLog,
  recordUsage,
} from "@/lib/ops-log";
import * as clientsDb from "@/lib/clients-db";
import { getAutomationEnabled } from "@/lib/app-settings";
import * as catalog from "@/lib/catalog";
import * as availability from "@/lib/availability";
import * as bookingService from "@/lib/booking-service";
import { validateOutboundFacts, quoteEmail, bookingConfirmation, missingInfoEmail, rescheduleConfirmation, cancellationConfirmation, cancellationFeeNotice } from "@/lib/templates";
import * as fs from "fs";
import * as path from "path";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Load rules file
function loadRules(): string {
  try {
    const rulesPath = path.join(process.cwd(), "src", "config", "RULES.md");
    return fs.readFileSync(rulesPath, "utf-8");
  } catch {
    return "Rules file not found — use default business rules from system prompt.";
  }
}

// Injected after every tool result to force the read -> act -> verify cycle.
const RULE_CHECK =
  "RULE CHECK: the rules are in your instructions above — no need to re-read them every step. Confirm the result above complies (price from catalog, slot from get_availability, required fields present, no off-policy discounts, complaints escalated, customer email only via compose_and_send). If it violated a rule, fix it before continuing. Gather read-only info freely, but make only ONE change (book/send/reschedule/cancel) per turn and verify it. STOP CONDITION: at most ONE customer email per inbound — once the customer's reply is sent, only record (create_inquiry/create_quote) and mark_email_done, then stop.";

// --- Classification Types ---
export type EmailClassification =
  | "BOOKING_REQUEST"
  | "RESCHEDULE"
  | "CANCELLATION"
  | "INQUIRY"
  | "COMPLAINT"
  | "EMPLOYEE_INTERNAL"
  | "CONFIRMATION_REPLY"
  | "SPAM_IRRELEVANT";

// --- The Automation System Prompt ---
async function buildAutomationPrompt(): Promise<string> {
  const opsContext = await getOpsLogSummary();
  const rules = loadRules();

  return `You are the AUTONOMOUS operations AI for ${BUSINESS.name}.

YOU ARE NOT CHATTING WITH A HUMAN. You are processing emails automatically.

=== MANDATORY RULES (read before every action) ===
${rules}
=== END RULES ===

YOUR PROTOCOL:
1. Read the ops log context below to know what's already been handled.
2. For each email, classify it and execute the correct workflow.
3. VERIFY before every action:
   - Check ops log: was this email already processed? If yes, SKIP.
   - Check calendar: is the slot actually free before booking?
   - Check details: are ALL required fields present before confirming?
4. After every action, call log_operation to record what you did.
5. After all actions, call mark_email_done to prevent reprocessing.

=== BOOKING WORKFLOW — FOLLOW THESE STAGES IN ORDER, NEVER SKIP AHEAD ===
A booking is only ever created AFTER the client has explicitly confirmed. On a client's first message you only ever do Stage 1 and Stage 2, then stop.

STAGE 1 — GATHER INFORMATION (nothing else):
Work out which service the client wants and collect what you need to respond. Use READ-ONLY tools only: get_service / list_services (price from the catalog) AND get_availability (real free slots from the database — always pull these so you can offer times). Do not book, do not promise anything. Only send a missing_info email if you genuinely cannot tell which service they want. You do NOT need the customer to supply a date — you offer available slots to them.

STAGE 2 — CONFIRM THE DETAILS WITH THE CLIENT:
Send the client a quote with compose_and_send (template "quote"): the service, the exact catalog price, and 2–3 specific available times from get_availability. Ask them to reply with the time that works to confirm. Then STOP. Do NOT create a booking. Wait for their reply.

STAGE 3 — VERIFY DETAILS, THEN CREATE THE BOOKING (only once the client confirms):
When the client's reply explicitly accepts a specific time:
a) Call get_required_booking_fields and confirm you have EVERY required field (client name, client email, service, date, time, address). If any is missing, send a missing_info email asking for it and STOP — do not book.
b) When all fields are present, call create_booking with clientConfirmed:true and confirmationEvidence set to the client's own words. This writes the booking to the database AND Google Calendar together, atomically. If the slot was taken meanwhile it returns alternatives — go back to Stage 2.

STAGE 4 — SEND THE CONFIRMED BOOKING EMAIL:
Send booking_confirmation with compose_and_send using the bookingId from Stage 3. It goes to BOTH the client and the owner — the owner is added automatically, so you do not need to send them a separate email.

STAGE 5 — CALENDAR:
The Google Calendar event is created as part of Stage 3 (atomic with the booking, so the two can never disagree). If create_booking reported a calendar error, notify the owner with notify_owner.

=== CANCELLATIONS & RESCHEDULES ===
First find the booking with get_client_history (by the customer's email) to get its bookingId.
- RESCHEDULE: call reschedule_booking with bookingId + the new date/time. If it returns alternatives (the new slot is taken), offer those and ask the customer to pick. On success, send compose_and_send (template "reschedule", bookingId).
- CANCEL: call cancel_booking with the bookingId. The system enforces the 24-hour notice policy for you — never decide it yourself:
  • returns success → the booking is cancelled; send compose_and_send (template "cancellation", bookingId).
  • returns feeApplies:true → do NOT cancel. Send compose_and_send (template "cancellation_fee_notice", bookingId) to tell the customer a fee applies, and notify the owner with notify_owner. Leave the booking in place.

=== WORK IN A READ → ACT → VERIFY CYCLE ===
The MANDATORY RULES are always present in your instructions above — they are in front of you every step, so you do NOT need to call read_rules each turn (use it only if you are genuinely unsure of a detail). Operate like this:
1. GATHER: you may call multiple READ-ONLY tools in a single turn (list_services, get_service, get_availability, get_booking) to collect everything you need at once.
2. ACT: take exactly ONE state-changing action per turn — create_booking, compose_and_send, send_email, reschedule, cancel. Never fire two changing actions in the same turn.
3. VERIFY: when the result returns, confirm it complied with the rules (price from catalog, slot from get_availability, required fields present, no off-policy discounts, complaints escalated). If anything violated a rule, fix it before the next action.
4. Repeat for the next change. After every tool result you'll get a short RULE CHECK reminder — actually do it.

ONE CUSTOMER REPLY PER EMAIL: Each inbound message gets exactly one customer-facing email. A booking request you can fulfil → ONE booking_confirmation (do NOT also send a quote). An inquiry → ONE quote. Missing info → ONE missing_info. After that reply is sent, record it and call mark_email_done — do not send anything else to the customer for this message.

=== DETERMINISM PROTOCOL (NON-NEGOTIABLE — these facts are owned by tools, not by you) ===
You must NEVER state a price, duration, or time slot from your own judgement. Every such fact comes from a tool result.
- PRICES & SERVICES: Call list_services (or get_service) and use the returned price EXACTLY. Never write a dollar amount that did not come from a tool result — outbound email is automatically blocked if you do. To choose a service, pick the service_id whose description best matches the request. If nothing fits, do not invent one — escalate to the owner.
- AVAILABILITY: Call get_availability(date, service_id). You may ONLY offer times it returns. Never propose a time you did not get from this tool. It reads the bookings database (the source of truth), not the calendar.
- BOOKING: First find_or_create_client to get clientId. Then call create_booking with { clientId, serviceId, date, startTime (HH:MM 24h), address, clientName, clientEmail }. It re-checks the slot, applies the catalog price, and writes both the database and the calendar. If it returns success:false with alternatives, offer those exact alternatives. If a required field is missing, ask for it — do NOT guess. Do NOT call create_booking_record afterwards.
- RECORD-KEEPING: Call create_inquiry once for every business email (pass threadId, gmailMessageId, clientId, type, summary). After you send a quote, call create_quote with the serviceId (price is taken from the catalog automatically).
- SENDING: Send every customer-facing email with compose_and_send (template = quote | booking_confirmation | missing_info | reschedule | cancellation). You do NOT write the body — the template fills it from source-of-truth data. For a quote, pass serviceId, slots (labels from get_availability only), and offerContract:true if the request signals recurring/commercial work. For confirmations/reschedule/cancellation, pass the bookingId. Use plain send_email ONLY for internal notes to the owner, never for customer quotes or confirmations.
- If any tool returns an error or success:false, surface it / ask the customer — never proceed as if it succeeded, and never fabricate a confirmation.

=== CONTRACT / VOLUME PRICING (a defined feature — use it, don't improvise it) ===
${BUSINESS.pricing.contract.enabled ? `When the customer's message signals recurring or commercial work (any of: ${BUSINESS.pricing.contract.triggers.join(", ")}):
- Still quote the standard per-visit catalog price from get_service as normal, AND
- Include this EXACT sentence, word for word: "${BUSINESS.pricing.contract.line}"
- CC the owner (${BUSINESS.owner.email}) so they can set the contract rate.
- You must NEVER invent a contract number, percentage, or "better rate" yourself — the owner sets all contract pricing.
Outside this defined trigger, never mention discounts, contract rates, "better rates", or negotiation of any kind.` : `Contract pricing is disabled. Never offer discounts, contract rates, or negotiation — escalate any such request to the owner.`}

=== RULES ARE THE ONLY AUTHORITY (by design) ===
Everything you say or do must be backed by a defined rule above/below or a tool result. You do not have discretion to improvise business terms, prices, promises, or policies. If a situation is not covered by a defined rule, do NOT make something up — record the inquiry and forward it to the owner (${BUSINESS.owner.email}).

EMAIL RECIPIENTS: The business has no inbound mailbox. NEVER email a "glowcleaning" or any business/company address, and never invent one. Customer replies go to the customer's own address (the sender). To reach the owner, use the notify_owner tool — do not type the owner's address yourself.


REQUIRED FIELDS FOR A BOOKING:
- Client name (first name minimum)
- Service type (or enough info to determine it)
- Preferred date
- Address OR "same as last time"
If ANY of these are missing, DO NOT book. Instead, send an email asking for the missing details.

DECISION RULES:
- NEVER auto-respond to complaints. Forward to ${BUSINESS.owner.email} with a summary.
- ALWAYS check calendar availability before confirming a booking.
- ALWAYS include price, duration, and cleaner name in confirmations.
- ALWAYS CC ${BUSINESS.owner.email} on bookings over $${Math.max(...BUSINESS.services.map((s) => s.price))}.
- If a time slot is taken, suggest the 3 nearest available slots.
- Use a ${BUSINESS.calendar.bufferMinutes}-minute buffer between appointments.
- Working hours: ${BUSINESS.calendar.workingHours.start} to ${BUSINESS.calendar.workingHours.end}.
- Working days: ${BUSINESS.calendar.workingDays.join(", ")}.

CURRENT OPS LOG:
${opsContext}

TODAY: ${new Date().toISOString().split("T")[0]}
TIMEZONE: ${BUSINESS.timezone}

SERVICES:
${BUSINESS.services.map((s) => `- ${s.name}: $${s.price}, ${s.duration}min — ${s.description}`).join("\n")}

EMPLOYEES:
${BUSINESS.employees.map((e) => `- ${e.name} <${e.email}> — specialties: ${e.specialties.join(", ")}`).join("\n")}

OWNER: ${BUSINESS.owner.name} <${BUSINESS.owner.email}>`;
}

// --- Automation Tools (same as chat tools + ops log tools) ---
const AUTOMATION_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_rules",
    description:
      "Return the full mandatory rules (RULES.md). Call this before each action to re-read the rules, then verify your action complies before continuing.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_services",
    description:
      "Return the exact service catalog (id, name, price, duration, description). ALWAYS use this to get prices — never state a price that did not come from here.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_required_booking_fields",
    description:
      "Return the list of fields that MUST be filled before a booking can be created. Call this when handling a booking, check you have every field, and ask the client (missing_info) for any that are missing before booking.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_service",
    description:
      "Return the canonical name, price, duration, and description for one service_id. Use the price exactly as returned.",
    input_schema: {
      type: "object" as const,
      properties: { service_id: { type: "string", description: "One of the ids from list_services" } },
      required: ["service_id"],
    },
  },
  {
    name: "get_availability",
    description:
      "Return the real free time slots for a service on a date, computed from the bookings database (the source of truth). You may ONLY offer times this returns. Never invent a slot.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        service_id: { type: "string", description: "Service id (determines duration)" },
      },
      required: ["date", "service_id"],
    },
  },
  {
    name: "create_inquiry",
    description:
      "Record an inbound customer email as a structured inquiry. Call this once per business email you handle, before responding.",
    input_schema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string" },
        gmailMessageId: { type: "string" },
        clientId: { type: "string" },
        type: { type: "string", description: "BOOKING_REQUEST | INQUIRY | RESCHEDULE | CANCELLATION | INFO | COMPLAINT | BILLING | EMPLOYEE_INTERNAL | VENDOR | SPAM" },
        summary: { type: "string" },
        requestedServiceId: { type: "string" },
        requestedDate: { type: "string" },
        requestedWindow: { type: "string" },
        address: { type: "string" },
        rawExcerpt: { type: "string" },
      },
      required: ["type"],
    },
  },
  {
    name: "create_quote",
    description:
      "Record a quote you sent. Price is taken from the catalog by service_id — do not pass a price.",
    input_schema: {
      type: "object" as const,
      properties: {
        inquiryId: { type: "string" },
        clientId: { type: "string" },
        serviceId: { type: "string" },
      },
      required: ["serviceId"],
    },
  },
  {
    name: "compose_and_send",
    description:
      "The ONLY way to send a customer-facing email. Picks a fixed template and fills it from source-of-truth data — you do not write the body. Use this for quotes, booking confirmations, missing-info requests, reschedules, and cancellations. (Plain send_email is for internal/owner notes only.)",
    input_schema: {
      type: "object" as const,
      properties: {
        template: {
          type: "string",
          enum: ["quote", "booking_confirmation", "missing_info", "reschedule", "cancellation", "cancellation_fee_notice"],
        },
        to: { type: "array", items: { type: "string" } },
        cc: { type: "array", items: { type: "string" } },
        threadId: { type: "string" },
        replyToMessageId: { type: "string" },
        firstName: { type: "string" },
        // quote
        serviceId: { type: "string", description: "for quote: which service" },
        slots: { type: "array", items: { type: "string" }, description: "for quote: labels from get_availability only" },
        offerContract: { type: "boolean", description: "for quote: true if the request signals recurring/commercial work" },
        // booking_confirmation / reschedule / cancellation
        bookingId: { type: "string", description: "for booking_confirmation/reschedule/cancellation: the booking id" },
        // missing_info
        missing: { type: "array", items: { type: "string" }, description: "for missing_info: which fields are missing" },
      },
      required: ["template", "to"],
    },
  },
  {
    name: "search_emails",
    description: "Search Gmail for emails matching a query.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read the full content of an email thread.",
    input_schema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string" },
      },
      required: ["threadId"],
    },
  },
  {
    name: "notify_owner",
    description:
      "Send an internal notification to the business owner (for escalations, complaints, cancellation fees, anything needing human follow-up). The owner's address is handled for you — do NOT pass a recipient and never email a business/glowcleaning address yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "send_email",
    description: "Send an email immediately. Use threadId and replyToMessageId to reply within an existing thread. Only ever address customers (their own email) — to reach the owner use notify_owner.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "array", items: { type: "string" } },
        threadId: { type: "string", description: "Gmail thread ID to reply in the same thread" },
        replyToMessageId: { type: "string", description: "Message-ID header of the email being replied to" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "draft_email",
    description: "Create a draft email for manager review (use for complaints or uncertain situations).",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "array", items: { type: "string" } },
        threadId: { type: "string", description: "Gmail thread ID to draft in the same thread" },
        replyToMessageId: { type: "string", description: "Message-ID header of the email being replied to" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "list_calendar_events",
    description: "List calendar events in a date range.",
    input_schema: {
      type: "object" as const,
      properties: {
        startDate: { type: "string" },
        endDate: { type: "string" },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "find_available_slots",
    description: "Find available time slots on a specific date.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string" },
        durationMinutes: { type: "number" },
      },
      required: ["date", "durationMinutes"],
    },
  },
  {
    name: "create_booking",
    description:
      "Create a booking — STAGE 3 of the workflow. ONLY call this after the client has explicitly confirmed the specific details you proposed to them (date, time, service). Never call it on a first contact or from an inquiry. Re-checks the slot is free, takes price/duration from the catalog by service_id, writes the booking to the database (source of truth) AND mirrors it to Google Calendar in one step. Returns confirmed details, or {success:false, alternatives} if the slot is taken. Requires clientConfirmed:true and confirmationEvidence (the client's own words accepting the details).",
    input_schema: {
      type: "object" as const,
      properties: {
        clientConfirmed: { type: "boolean", description: "Must be true. Set only when the client has explicitly accepted the specific date/time/service you proposed." },
        confirmationEvidence: { type: "string", description: "The client's own words showing they accepted (e.g. 'yes, book me for Tuesday 8am')." },
        clientId: { type: "string" },
        serviceId: { type: "string", description: "From list_services" },
        date: { type: "string", description: "YYYY-MM-DD" },
        startTime: { type: "string", description: "HH:MM (24h, business local time)" },
        address: { type: "string" },
        clientName: { type: "string" },
        clientEmail: { type: "string" },
        employeeName: { type: "string" },
        employeeEmail: { type: "string" },
        notes: { type: "string" },
      },
      required: ["clientConfirmed", "confirmationEvidence", "clientId", "serviceId", "date", "startTime", "address"],
    },
  },
  {
    name: "reschedule_booking",
    description:
      "Reschedule an existing booking to a new date/time, by bookingId (get it from get_client_history). Revalidates the new slot is free, updates the database AND Google Calendar together, and frees the old slot. Returns the new times, or {success:false, alternatives} if the new slot is taken.",
    input_schema: {
      type: "object" as const,
      properties: {
        bookingId: { type: "string" },
        newDate: { type: "string", description: "YYYY-MM-DD" },
        newStartTime: { type: "string", description: "HH:MM (24h)" },
      },
      required: ["bookingId", "newDate", "newStartTime"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel an existing booking by bookingId (get it from get_client_history). Enforces the cancellation notice policy: if the appointment is more than the notice window away, it cancels (frees the slot + removes the calendar event). If it is WITHIN the notice window, it does NOT cancel and returns {feeApplies:true} — in that case inform the customer a fee applies (compose_and_send template 'cancellation_fee_notice') and notify the owner; do not cancel.",
    input_schema: {
      type: "object" as const,
      properties: {
        bookingId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["bookingId"],
    },
  },
  // --- Ops Log Tools (AI's persistent memory) ---
  {
    name: "log_operation",
    description:
      "Log an action to the persistent operations file. CALL THIS AFTER EVERY ACTION YOU TAKE.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: [
            "email_received",
            "email_sent",
            "email_drafted",
            "booking_created",
            "booking_updated",
            "booking_cancelled",
            "reminder_sent",
            "classification",
            "error",
            "verification_failed",
          ],
        },
        emailId: { type: "string" },
        threadId: { type: "string" },
        from: { type: "string" },
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        classification: { type: "string" },
        calendarEventId: { type: "string" },
        details: { type: "string" },
      },
      required: ["type", "details"],
    },
  },
  {
    name: "mark_email_done",
    description:
      "Mark an email as fully processed to prevent re-processing on next cycle.",
    input_schema: {
      type: "object" as const,
      properties: {
        messageId: { type: "string" },
        threadId: { type: "string" },
        classification: { type: "string" },
        actionTaken: { type: "string" },
      },
      required: ["messageId", "classification", "actionTaken"],
    },
  },
  {
    name: "check_already_processed",
    description: "Check if an email has already been processed.",
    input_schema: {
      type: "object" as const,
      properties: {
        messageId: { type: "string" },
      },
      required: ["messageId"],
    },
  },
  {
    name: "get_ops_summary",
    description: "Read the current operations log summary.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // --- Client Database Tools ---
  {
    name: "find_or_create_client",
    description: "Look up a client by email. If they exist, returns their record and booking history. If not, creates a new record. Call this FIRST for every email — before booking, quoting, or responding. Returns missing fields that need to be asked for.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: { type: "string", description: "Client email address" },
        name: { type: "string", description: "Client full name" },
        firstName: { type: "string", description: "Client first name" },
        lastName: { type: "string", description: "Client last name" },
        phone: { type: "string", description: "Client phone number" },
        address: { type: "string", description: "Service address" },
        city: { type: "string", description: "City" },
        postalCode: { type: "string", description: "Postal code" },
      },
      required: ["email"],
    },
  },
  {
    name: "create_booking_record",
    description: "Create a booking record in the database AFTER creating the calendar event. Links the booking to the client record for history tracking.",
    input_schema: {
      type: "object" as const,
      properties: {
        clientId: { type: "string", description: "Client ID from find_or_create_client" },
        serviceId: { type: "string", description: "Service ID (e.g., 'regular', 'deep', 'turnover')" },
        serviceName: { type: "string", description: "Service name for display" },
        price: { type: "number", description: "Price in CAD" },
        date: { type: "string", description: "Date (YYYY-MM-DD)" },
        time: { type: "string", description: "Time (HH:MM)" },
        duration: { type: "number", description: "Duration in minutes" },
        address: { type: "string", description: "Service address" },
        employeeName: { type: "string", description: "Assigned team/cleaner name" },
        employeeEmail: { type: "string", description: "Assigned team/cleaner email" },
        calendarEventId: { type: "string", description: "Google Calendar event ID" },
        notes: { type: "string", description: "Any special instructions" },
      },
      required: ["clientId", "serviceId", "serviceName", "price", "date", "time", "duration", "address"],
    },
  },
  {
    name: "get_client_history",
    description: "Get a client's full booking history, total spent, and booking count. Use this to personalize responses for returning clients.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: { type: "string", description: "Client email address" },
      },
      required: ["email"],
    },
  },
  {
    name: "update_client",
    description: "Update a client's information when you learn new details (phone, address change, notes).",
    input_schema: {
      type: "object" as const,
      properties: {
        clientId: { type: "string", description: "Client ID" },
        name: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        postalCode: { type: "string" },
        notes: { type: "string" },
      },
      required: ["clientId"],
    },
  },
  {
    name: "cancel_booking_record",
    description: "Update a booking record to cancelled status in the database.",
    input_schema: {
      type: "object" as const,
      properties: {
        calendarEventId: { type: "string", description: "Calendar event ID of the booking to cancel" },
        reason: { type: "string", description: "Cancellation reason" },
      },
      required: ["calendarEventId"],
    },
  },
];

// --- Tool Executor ---
async function executeTool(
  toolName: string,
  input: any,
  accessToken: string,
  ctx: { repliedTo: Set<string>; messageId?: string } = { repliedTo: new Set() }
): Promise<string> {
  const ownerEmail = BUSINESS.owner.email.toLowerCase();
  const employeeEmails = new Set(BUSINESS.employees.map((e) => (e.email || "").toLowerCase()).filter(Boolean));
  const isCustomer = (a: string) => {
    const x = (a || "").toLowerCase();
    return x && x !== ownerEmail && !employeeEmails.has(x);
  };
  // The business has no inbound mailbox — never email a glowcleaning address.
  const isBusinessAddress = (a: string) => /glowcleaning/i.test(a || "");
  try {
    switch (toolName) {
      case "read_rules": {
        return loadRules();
      }
      case "list_services": {
        return JSON.stringify(catalog.listServices(), null, 2);
      }
      case "get_required_booking_fields": {
        return JSON.stringify({
          requiredBeforeBooking: [
            { field: "clientName", note: "the client's name" },
            { field: "clientEmail", note: "usually the sender's address" },
            { field: "serviceId", note: "which service, from the catalog" },
            { field: "date", note: "YYYY-MM-DD" },
            { field: "startTime", note: "HH:MM, must be a free slot from get_availability" },
            { field: "address", note: "the service address" },
          ],
          rule: "All of these must be present AND the client must have confirmed before you call create_booking. Ask for any missing field with a missing_info email and stop.",
        });
      }
      case "get_service": {
        const svc = catalog.getService(input.service_id);
        if (!svc) return JSON.stringify({ error: `Unknown service_id '${input.service_id}'. Call list_services for valid ids.` });
        return JSON.stringify(svc, null, 2);
      }
      case "get_availability": {
        const result = await availability.getAvailability(input.date, input.service_id);
        return JSON.stringify(result, null, 2);
      }
      case "create_inquiry": {
        const inq = await clientsDb.createInquiry({
          threadId: input.threadId,
          gmailMessageId: input.gmailMessageId,
          clientId: input.clientId,
          type: input.type,
          summary: input.summary,
          requestedServiceId: input.requestedServiceId,
          requestedDate: input.requestedDate,
          requestedWindow: input.requestedWindow,
          address: input.address,
          rawExcerpt: input.rawExcerpt,
        });
        return JSON.stringify({ success: true, inquiryId: inq.id });
      }
      case "create_quote": {
        const svc = catalog.getService(input.serviceId);
        if (!svc) return JSON.stringify({ error: `Unknown service_id '${input.serviceId}'` });
        const q = await clientsDb.createQuote({
          inquiryId: input.inquiryId,
          clientId: input.clientId,
          serviceId: svc.id,
          serviceName: svc.name,
          price: svc.price,
          sourceMessageId: ctx.messageId,
        });
        return JSON.stringify({ success: true, quoteId: q.id, price: svc.price });
      }
      case "compose_and_send": {
        if ((input.to || []).some(isBusinessAddress)) {
          return JSON.stringify({ success: false, blocked: true, error: "You tried to email a business/glowcleaning address. Customer emails go to the customer's own address; to reach the owner use notify_owner." });
        }
        const ccust = (input.to || []).filter(isCustomer);
        if (ccust.some((a: string) => ctx.repliedTo.has(a.toLowerCase()))) {
          return JSON.stringify({ success: false, blocked: true, error: "Already sent this customer their one reply this run. Do NOT send another email — record (create_inquiry/create_quote) and mark_email_done instead." });
        }
        const t = input.template;
        const endStr = (time: string, duration: number) => {
          const [h, m] = String(time).slice(0, 5).split(":").map(Number);
          const em = h * 60 + (m || 0) + Number(duration);
          return `${String(Math.floor(em / 60)).padStart(2, "0")}:${String(em % 60).padStart(2, "0")}`;
        };
        let built: { subject: string; body: string };
        let allowedPrices: number[] = [];

        if (t === "quote") {
          const svc = catalog.getService(input.serviceId);
          if (!svc) return JSON.stringify({ success: false, error: `Unknown service_id '${input.serviceId}'` });
          built = quoteEmail({
            firstName: input.firstName,
            serviceName: svc.name,
            price: svc.price,
            description: svc.description,
            slots: (input.slots || []).map((s: string) => ({ label: s })),
            offerContract: !!input.offerContract,
          });
          allowedPrices = [svc.price];
        } else if (t === "booking_confirmation") {
          const b = await clientsDb.getBookingById(input.bookingId);
          if (!b) return JSON.stringify({ success: false, error: `Booking '${input.bookingId}' not found` });
          built = bookingConfirmation({
            firstName: input.firstName,
            serviceName: b.service_name,
            date: String(b.date).slice(0, 10),
            start: String(b.time).slice(0, 5),
            end: endStr(b.time, b.duration),
            address: b.address,
            cleaner: b.employee_name || undefined,
            price: Number(b.price),
            duration: b.duration,
          });
          allowedPrices = [Number(b.price)];
        } else if (t === "missing_info") {
          built = missingInfoEmail({ firstName: input.firstName, missing: input.missing || [] });
        } else if (t === "reschedule") {
          const b = await clientsDb.getBookingById(input.bookingId);
          if (!b) return JSON.stringify({ success: false, error: `Booking '${input.bookingId}' not found` });
          built = rescheduleConfirmation({
            firstName: input.firstName,
            serviceName: b.service_name,
            newDate: String(b.date).slice(0, 10),
            start: String(b.time).slice(0, 5),
            end: endStr(b.time, b.duration),
          });
        } else if (t === "cancellation") {
          const b = await clientsDb.getBookingById(input.bookingId);
          if (!b) return JSON.stringify({ success: false, error: `Booking '${input.bookingId}' not found` });
          built = cancellationConfirmation({
            firstName: input.firstName,
            serviceName: b.service_name,
            date: String(b.date).slice(0, 10),
          });
        } else if (t === "cancellation_fee_notice") {
          const b = await clientsDb.getBookingById(input.bookingId);
          if (!b) return JSON.stringify({ success: false, error: `Booking '${input.bookingId}' not found` });
          built = cancellationFeeNotice({
            firstName: input.firstName,
            serviceName: b.service_name,
            date: String(b.date).slice(0, 10),
            feeLine: BUSINESS.cancellation.feeLine,
          });
        } else {
          return JSON.stringify({ success: false, error: `Unknown template '${t}'` });
        }

        const check = validateOutboundFacts(
          built.body,
          allowedPrices.length ? allowedPrices : catalog.listServices().map((s) => s.price)
        );
        if (!check.ok) {
          return JSON.stringify({ success: false, blocked: true, error: check.violations.join("; ") });
        }
        // The booking confirmation also goes to the owner (same account the AI uses).
        const ccList = [...(input.cc || [])];
        if (t === "booking_confirmation") {
          const ownerAddr = BUSINESS.owner.email;
          if (ownerAddr && !ccList.some((a: string) => a.toLowerCase() === ownerAddr.toLowerCase())) {
            ccList.push(ownerAddr);
          }
        }
        const sent = await gmail.sendEmail(accessToken, input.to, built.subject, built.body, ccList, input.replyToMessageId, input.threadId);
        ccust.forEach((a: string) => ctx.repliedTo.add(a.toLowerCase()));
        // Auto-record the proposal so a later confirmation reply can be booked
        // (the booking gate requires a prior proposal). Reliable — not dependent
        // on the model separately calling create_quote.
        if (t === "quote") {
          const svcQ = catalog.getService(input.serviceId);
          if (svcQ) {
            try {
              await clientsDb.createQuote({
                clientId: input.clientId,
                serviceId: svcQ.id,
                serviceName: svcQ.name,
                price: svcQ.price,
                sourceMessageId: ctx.messageId,
                customerEmail: (input.to || [])[0],
              });
            } catch {}
          }
        }
        await appendOperation({
          type: "email_sent",
          to: input.to,
          subject: built.subject,
          threadId: input.threadId,
          details: `[${t}] ${built.subject}`,
          verified: true,
        });
        return JSON.stringify({ success: true, messageId: sent.id, threadId: sent.threadId, subject: built.subject });
      }
      case "search_emails": {
        const threads = await gmail.searchEmails(accessToken, input.query, input.maxResults || 10);
        return JSON.stringify(threads.slice(0, 10), null, 2);
      }
      case "read_email": {
        const thread = await gmail.getThread(accessToken, input.threadId);
        return JSON.stringify(thread, null, 2);
      }
      case "notify_owner": {
        const sent = await gmail.sendEmail(accessToken, [BUSINESS.owner.email], input.subject, input.body);
        await appendOperation({
          type: "email_sent",
          to: [BUSINESS.owner.email],
          subject: input.subject,
          details: `[owner_notification] ${input.subject}`,
          verified: true,
        });
        return JSON.stringify({ success: true, messageId: sent.id });
      }
      case "send_email": {
        if ((input.to || []).some(isBusinessAddress)) {
          return JSON.stringify({ success: false, blocked: true, error: "You tried to email a business/glowcleaning address. The business has no inbound mailbox. To reach the owner use notify_owner; to reach the customer use their own address." });
        }
        const scust = (input.to || []).filter(isCustomer);
        if (scust.some((a: string) => ctx.repliedTo.has(a.toLowerCase()))) {
          return JSON.stringify({ success: false, blocked: true, error: "Already replied to this customer this run. Do not send another email — record and mark_email_done." });
        }
        // Backstop: block any outbound whose dollar amounts aren't real catalog prices.
        const priceCheck = validateOutboundFacts(
          input.body || "",
          catalog.listServices().map((s) => s.price)
        );
        if (!priceCheck.ok) {
          return JSON.stringify({
            success: false,
            blocked: true,
            error: "Email NOT sent — contains a price not in the catalog. Use get_service to get the exact price and rewrite. " + priceCheck.violations.join("; "),
          });
        }
        const sent = await gmail.sendEmail(accessToken, input.to, input.subject, input.body, input.cc, input.replyToMessageId, input.threadId);
        scust.forEach((a: string) => ctx.repliedTo.add(a.toLowerCase()));
        await appendOperation({
          type: "email_sent",
          to: input.to,
          subject: input.subject,
          threadId: input.threadId,
          details: `Sent to ${input.to.join(", ")}: ${input.subject}`,
          verified: true,
        });
        return JSON.stringify({ success: true, messageId: sent.id, threadId: sent.threadId });
      }
      case "draft_email": {
        const draft = await gmail.createDraft(accessToken, input.to, input.subject, input.body, input.cc, input.replyToMessageId, input.threadId);
        await appendOperation({
          type: "email_drafted",
          to: input.to,
          subject: input.subject,
          threadId: input.threadId,
          details: `Draft created for ${input.to.join(", ")}: ${input.subject}`,
          verified: true,
        });
        return JSON.stringify({ success: true, draftId: draft.id });
      }
      case "list_calendar_events": {
        const events = await calendar.listEvents(
          accessToken,
          `${input.startDate}T00:00:00Z`,
          `${input.endDate}T23:59:59Z`
        );
        return JSON.stringify(
          events.map((e: any) => ({
            id: e.id,
            summary: e.summary,
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
            location: e.location,
          })),
          null, 2
        );
      }
      case "find_available_slots": {
        const slots = await calendar.findFreeSlots(accessToken, input.date, input.durationMinutes);
        return JSON.stringify(slots, null, 2);
      }
      case "create_booking": {
        // Field completeness — all required booking fields must be present.
        const requiredFields: Record<string, any> = {
          clientName: input.clientName,
          clientEmail: input.clientEmail,
          serviceId: input.serviceId,
          date: input.date,
          startTime: input.startTime,
          address: input.address,
        };
        const missingFields = Object.entries(requiredFields)
          .filter(([, v]) => !String(v ?? "").trim())
          .map(([k]) => k);
        if (missingFields.length) {
          return JSON.stringify({
            success: false,
            blocked: true,
            missingFields,
            reason: `Missing required booking fields: ${missingFields.join(", ")}. Do NOT book. Ask the client for these with a missing_info email, then wait for their reply.`,
          });
        }
        if (input.clientConfirmed !== true || !String(input.confirmationEvidence || "").trim()) {
          return JSON.stringify({
            success: false,
            blocked: true,
            reason: "Not yet confirmed by the client. Do NOT book yet. Complete STAGE 2 first: send the client the proposed details (service, price, specific time) and wait for them to explicitly confirm. Only call create_booking once they have accepted, passing clientConfirmed:true and their words as confirmationEvidence.",
          });
        }
        // Hard rail: a booking requires a proposal already sent to this client in a
        // PRIOR inbound message (i.e. this message is their confirmation reply).
        // This makes booking-on-first-contact impossible regardless of what the model claims.
        const priorProposal = (input.clientId || input.clientEmail)
          ? await clientsDb.hasPriorProposal({ clientId: input.clientId, email: input.clientEmail }, ctx.messageId)
          : false;
        if (!priorProposal) {
          return JSON.stringify({
            success: false,
            blocked: true,
            reason: "No prior proposal on record for this client. You cannot book on first contact. STAGE 2 first: send a quote with the price and specific available times and ask the client to confirm. Book only after they reply confirming a time.",
          });
        }
        const r = await bookingService.createBookingGuarded(accessToken, {
          clientId: input.clientId,
          clientEmail: input.clientEmail,
          clientName: input.clientName,
          serviceId: input.serviceId,
          date: input.date,
          startTime: input.startTime,
          address: input.address,
          employeeName: input.employeeName,
          employeeEmail: input.employeeEmail,
          notes: input.notes,
        });
        if (!r.ok) {
          return JSON.stringify({ success: false, reason: r.reason, alternatives: r.alternatives || [] });
        }
        await appendOperation({
          type: "booking_created",
          calendarEventId: r.calendarEventId || undefined,
          details: `Booking ${r.bookingId}: ${r.service.name} on ${input.date} ${r.start}-${r.end} for $${r.service.price}`,
          verified: true,
        });
        return JSON.stringify({ success: true, bookingId: r.bookingId, calendarEventId: r.calendarEventId, service: r.service, date: input.date, start: r.start, end: r.end });
      }
      case "reschedule_booking": {
        const r = await bookingService.rescheduleGuarded(accessToken, input.bookingId, input.newDate, input.newStartTime);
        if (!r.ok) {
          return JSON.stringify({ success: false, reason: r.reason, alternatives: r.alternatives || [] });
        }
        await appendOperation({
          type: "booking_updated",
          details: `Rescheduled ${input.bookingId} to ${input.newDate} ${r.start}-${r.end}`,
          verified: true,
        });
        return JSON.stringify({ success: true, bookingId: input.bookingId, newDate: input.newDate, start: r.start, end: r.end });
      }
      case "cancel_booking": {
        const r = await bookingService.cancelGuarded(accessToken, input.bookingId, input.reason);
        if (r.feeApplies) {
          await appendOperation({
            type: "booking_cancelled",
            details: `Cancellation within notice window for ${input.bookingId} (~${Math.round(r.hoursUntil || 0)}h before) — fee applies, NOT cancelled. Inform customer + owner.`,
            verified: true,
          });
          return JSON.stringify({
            success: true,
            cancelled: false,
            feeApplies: true,
            hoursUntil: Math.round(r.hoursUntil || 0),
            instruction:
              "This is NOT an error. The appointment is within the 24h notice window, so the booking was deliberately left ACTIVE (not cancelled). Do exactly two things and nothing else: (1) Send the customer the fee notice — you MUST use compose_and_send with template 'cancellation_fee_notice' and this bookingId. Do NOT use send_email and do NOT write your own wording; the template is the exact approved message. Do not tell them it is cancelled. (2) notify_owner about the same-day cancellation request. Do not call cancel_booking again.",
          });
        }
        if (!r.ok) {
          return JSON.stringify({ success: false, reason: r.reason });
        }
        await appendOperation({
          type: "booking_cancelled",
          details: `Cancelled ${input.bookingId}`,
          verified: true,
        });
        return JSON.stringify({ success: true, bookingId: input.bookingId });
      }
      case "log_operation": {
        const op = await appendOperation({
          type: input.type,
          emailId: input.emailId,
          threadId: input.threadId,
          from: input.from,
          to: input.to,
          subject: input.subject,
          classification: input.classification,
          calendarEventId: input.calendarEventId,
          details: input.details,
          verified: true,
        });
        return JSON.stringify({ logged: true, operationId: op.id });
      }
      case "mark_email_done": {
        await markEmailProcessed({
          messageId: input.messageId,
          threadId: input.threadId || "",
          processedAt: new Date().toISOString(),
          classification: input.classification,
          actionTaken: input.actionTaken,
        });
        return JSON.stringify({ marked: true });
      }
      case "check_already_processed": {
        // Deduplication is handled atomically at claim time (exactly-once),
        // so the agent should always proceed. Never report a claimed-in-progress
        // message as already done.
        return JSON.stringify({ processed: false });
      }
      case "get_ops_summary": {
        return await getOpsLogSummary();
      }
      // --- Client Database Tools ---
      case "find_or_create_client": {
        const result = await clientsDb.findOrCreateClient({
          email: input.email,
          name: input.name,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          address: input.address,
          city: input.city,
          postalCode: input.postalCode,
          source: "email",
        });
        // Also get booking history for returning clients
        const history = await clientsDb.getClientBookings(result.client.id);
        return JSON.stringify({
          client: result.client,
          isNewClient: result.created,
          missingFields: result.missingFields,
          bookingHistory: history.slice(0, 5),
          totalBookings: history.length,
        }, null, 2);
      }
      case "create_booking_record": {
        // No-op: create_booking already writes the DB row (source of truth)
        // and mirrors to Calendar. A second insert here would duplicate the
        // booking and corrupt availability, so we don't.
        return JSON.stringify({ success: true, note: "Already recorded by create_booking — no separate record needed." });
      }
      case "get_client_history": {
        const history = await clientsDb.getClientHistory(input.email);
        return JSON.stringify({
          client: history.client,
          recentBookings: history.bookings.slice(0, 10),
          totalSpent: history.totalSpent,
          bookingCount: history.bookingCount,
          isReturningClient: history.bookingCount > 0,
        }, null, 2);
      }
      case "update_client": {
        const updated = await clientsDb.updateClient(input.clientId, {
          name: input.name,
          phone: input.phone,
          address: input.address,
          city: input.city,
          postalCode: input.postalCode,
          notes: input.notes,
        });
        return JSON.stringify({ success: true, client: updated });
      }
      case "cancel_booking_record": {
        const booking = await clientsDb.getBookingByCalendarEvent(input.calendarEventId);
        if (booking) {
          await clientsDb.updateBookingStatus(booking.id, "cancelled", input.reason);
          return JSON.stringify({ success: true, bookingId: booking.id });
        }
        return JSON.stringify({ success: false, error: "Booking not found for this calendar event" });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    appendOperation({
      type: "error",
      details: `Tool ${toolName} failed: ${err.message}`,
      verified: false,
    });
    return JSON.stringify({ error: err.message });
  }
}

// --- Shared agent loop (OpenAI-compatible: Gemini / DeepSeek / etc.) ---
// Runs the read→act→verify tool loop, records usage, appends to `actions`.
// Native Anthropic loop WITH prompt caching (cache_control on system + tools).
// Caching is a cost/latency optimization only — model input is identical, so
// output quality and reliability are unchanged.
async function runAnthropicLoop(
  systemPrompt: string,
  userMessage: string,
  accessToken: string,
  actions: string[],
  context: string,
  primaryMessageId?: string
): Promise<void> {
  const ctx = { repliedTo: new Set<string>(), messageId: primaryMessageId };
  const tools = AUTOMATION_TOOLS.map((t, idx) =>
    idx === AUTOMATION_TOOLS.length - 1 ? ({ ...t, cache_control: { type: "ephemeral" } } as any) : t
  );
  const system: any = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  let calls = 0, fresh = 0, cacheRead = 0, cacheCreate = 0, out = 0;

  try {
    for (let i = 0; i < 40; i++) {
      let resp: Anthropic.Message;
      for (let attempt = 0; ; attempt++) {
        try {
          resp = await client.messages.create({
            model: AI_MODEL,
            max_tokens: 4096,
            temperature: 0,
            system,
            tools: tools as any,
            messages,
          });
          break;
        } catch (e: any) {
          const status = e?.status;
          const blob = `${e?.message || ""} ${JSON.stringify(e?.error || "")}`;
          const billing = /credit|billing|balance|quota/i.test(blob);
          if ((status === 429 || status === 529) && !billing && attempt < 3) {
            await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
      calls++;
      const u: any = resp.usage || {};
      fresh += u.input_tokens || 0;
      out += u.output_tokens || 0;
      cacheRead += u.cache_read_input_tokens || 0;
      cacheCreate += u.cache_creation_input_tokens || 0;

      const toolUse = resp.content.filter((b) => b.type === "tool_use");
      const texts = resp.content.filter((b) => b.type === "text").map((b) => (b as any).text);
      if (texts.length) actions.push(...texts);

      if (toolUse.length === 0 || resp.stop_reason === "end_turn") break;

      messages.push({ role: "assistant", content: resp.content });
      const toolResults: any[] = [];
      for (const tu of toolUse) {
        const t = tu as any;
        const result = await executeTool(t.name, t.input, accessToken, ctx);
        toolResults.push({ type: "tool_result", tool_use_id: t.id, content: result });
        actions.push(`Tool: ${t.name}(${JSON.stringify(t.input).slice(0, 100)})`);
      }
      toolResults.push({ type: "text", text: RULE_CHECK });
      messages.push({ role: "user", content: toolResults });
    }
  } finally {
    await recordUsage({
      model: AI_MODEL,
      context,
      calls,
      inputTokens: fresh + cacheRead + cacheCreate,
      outputTokens: out,
      freshInputTokens: fresh,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreate,
    });
  }
}

async function runAgentLoop(
  systemPrompt: string,
  userMessage: string,
  accessToken: string,
  actions: string[],
  context: string,
  primaryMessageId?: string
): Promise<void> {
  if ((process.env.AI_PROVIDER || "").toLowerCase() === "anthropic") {
    return runAnthropicLoop(systemPrompt, userMessage, accessToken, actions, context, primaryMessageId);
  }
  const ctx = { repliedTo: new Set<string>(), messageId: primaryMessageId };
  const tools = toOpenAITools(AUTOMATION_TOOLS as any);
  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
  let calls = 0, inTok = 0, outTok = 0;

  try {
    for (let i = 0; i < 40; i++) {
      let resp: any;
      for (let attempt = 0; ; attempt++) {
        try {
          resp = await llm.chat.completions.create({
            model: AI_MODEL,
            temperature: 0,
            max_tokens: 4096,
            messages,
            tools,
            tool_choice: "auto",
          });
          break;
        } catch (e: any) {
          const status = e?.status || e?.response?.status;
          const blob = `${e?.message || ""} ${JSON.stringify(e?.error || e?.response?.data || "")}`;
          const billing = /prepay|billing|credit|depleted|quota.*exceeded|RESOURCE_EXHAUSTED/i.test(blob);
          // Billing/credit exhaustion won't fix itself — fail fast. Only back off on transient rate limits.
          if (status === 429 && !billing && attempt < 3) {
            await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
      calls++;
      inTok += resp.usage?.prompt_tokens || 0;
      outTok += resp.usage?.completion_tokens || 0;

      const msg = resp.choices[0]?.message;
      if (!msg) break;
      if (msg.content) actions.push(msg.content);

      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const fn = (tc as any).function;
        let args: any = {};
        try { args = JSON.parse(fn.arguments || "{}"); } catch { args = {}; }
        const result = await executeTool(fn.name, args, accessToken, ctx);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        actions.push(`Tool: ${fn.name}(${JSON.stringify(args).slice(0, 100)})`);
      }

      messages.push({ role: "user", content: RULE_CHECK });
    }
  } finally {
    await recordUsage({ model: AI_MODEL, context, calls, inputTokens: inTok, outputTokens: outTok });
  }
}

// --- Main Automation Cycle ---
export async function runAutomationCycle(accessToken: string): Promise<{
  processed: number;
  actions: string[];
  errors: string[];
}> {
  const actions: string[] = [];
  const errors: string[] = [];

  // Respect the dashboard Start/Stop switch.
  if (!(await getAutomationEnabled())) {
    return { processed: 0, actions: ["automation stopped"], errors: [] };
  }

  appendOperation({
    type: "email_received",
    details: "Automation cycle started",
    verified: true,
  });

  try {
    // Fetch unread emails
    const emails = await gmail.getRecentEmails(accessToken, 20);
    const unprocessed: typeof emails = [];
    for (const e of emails) {
      if (!(await isEmailProcessed(e.id))) unprocessed.push(e);
    }

    if (unprocessed.length === 0) {
      appendOperation({
        type: "email_received",
        details: "No new emails to process",
        verified: true,
      });
      return { processed: 0, actions: ["No new emails"], errors: [] };
    }

    // Build the processing prompt with all unprocessed emails
    const emailSummaries = unprocessed
      .map(
        (e, i) =>
          `EMAIL ${i + 1}:
  ID: ${e.id}
  Thread: ${e.threadId}
  Message-ID: ${(e as any).messageId || "unknown"}
  From: ${e.from}
  To: ${e.to}
  Subject: ${e.subject}
  Date: ${e.date}
  Body: ${e.body?.slice(0, 1000) || e.snippet}

IMPORTANT: When replying to this email, use threadId="${e.threadId}" and replyToMessageId="${(e as any).messageId || ""}" in your send_email call to keep the conversation in the same thread.`
      )
      .join("\n\n---\n\n");

    const userMessage = `Process these ${unprocessed.length} new email(s). For EACH email:
1. Classify it, then execute the correct workflow (see the staged BOOKING WORKFLOW for booking requests)
3. If already processed: skip it

EMAILS TO PROCESS:

${emailSummaries}`;

    // Run the AI with the tool loop
    const systemPrompt = await buildAutomationPrompt();
    await runAgentLoop(systemPrompt, userMessage, accessToken, actions, "automation_cycle", unprocessed[0]?.id);

    appendOperation({
      type: "email_received",
      details: `Automation cycle complete. Processed ${unprocessed.length} emails.`,
      verified: true,
    });

    return { processed: unprocessed.length, actions, errors };
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    errors.push(errorMsg);
    appendOperation({
      type: "error",
      details: `Automation cycle error: ${errorMsg}`,
      verified: false,
    });
    return { processed: 0, actions, errors };
  }
}

// ============================================================
// EVENT-DRIVEN PROCESSING — handle a specific set of message IDs
// ============================================================
// Called by the Gmail push webhook with exactly the messages that
// arrived (from history.list). No inbox re-scan, no polling.
export async function runAutomationForMessages(
  accessToken: string,
  messageIds: string[]
): Promise<{ processed: number; actions: string[]; errors: string[] }> {
  const actions: string[] = [];
  const errors: string[] = [];

  // Fetch + filter to genuinely new, business-relevant messages.
  const unprocessed: any[] = [];
  for (const id of messageIds) {
    try {
      const msg = await gmail.getMessage(accessToken, id);
      const labels = (msg as any).labelIds || [];
      if (labels.includes("SENT") || labels.includes("DRAFT")) continue;
      // Atomic claim — only the first concurrent processor proceeds. Prevents
      // double-processing from webhook retries or Pub/Sub redelivery.
      if (!(await claimEmail(id, (msg as any).threadId))) continue;
      unprocessed.push(msg);
    } catch (e: any) {
      errors.push(`fetch ${id}: ${e.message || e}`);
    }
  }

  if (unprocessed.length === 0) {
    return { processed: 0, actions: ["No new messages to process"], errors };
  }

  const emailSummaries = unprocessed
    .map(
      (e, i) =>
        `EMAIL ${i + 1}:
  ID: ${e.id}
  Thread: ${e.threadId}
  Message-ID: ${e.messageId || "unknown"}
  From: ${e.from}
  To: ${e.to}
  Subject: ${e.subject}
  Date: ${e.date}
  Body: ${e.body?.slice(0, 1000) || e.snippet}

IMPORTANT: When replying, use threadId="${e.threadId}" and replyToMessageId="${e.messageId || ""}" to stay in the same thread.`
    )
    .join("\n\n---\n\n");

  const userMessage = `Process these ${unprocessed.length} new email(s). For EACH email:
1. Classify it, then execute the correct workflow (see the staged BOOKING WORKFLOW for booking requests)
3. If already processed: skip it

EMAILS TO PROCESS:

${emailSummaries}`;

  const systemPrompt = await buildAutomationPrompt();

  try {
    await runAgentLoop(systemPrompt, userMessage, accessToken, actions, "webhook_messages", unprocessed[0]?.id);
  } catch (err: any) {
    errors.push(err.message || String(err));
  }

  return { processed: unprocessed.length, actions, errors };
}
