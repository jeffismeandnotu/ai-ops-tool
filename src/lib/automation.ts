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
import { BUSINESS } from "@/config/business";
import * as gmail from "@/lib/gmail";
import * as calendar from "@/lib/calendar";
import {
  appendOperation,
  isEmailProcessed,
  markEmailProcessed,
  getOpsLogSummary,
  readOpsLog,
} from "@/lib/ops-log";
import * as clientsDb from "@/lib/clients-db";
import * as catalog from "@/lib/catalog";
import * as availability from "@/lib/availability";
import * as bookingService from "@/lib/booking-service";
import { validateOutboundFacts, quoteEmail, bookingConfirmation, missingInfoEmail, rescheduleConfirmation, cancellationConfirmation } from "@/lib/templates";
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
  "RULE CHECK — before your next action: re-read the MANDATORY RULES (call read_rules if you need the full text) and confirm the result above complies with every rule (correct price from the catalog, slot from get_availability, all required fields present, no discounts/negotiation outside the contract feature, complaints escalated, customer emails sent only via compose_and_send). If anything violated a rule, fix it now before doing anything else. Take ONE action at a time. IMPORTANT STOP CONDITION: send AT MOST ONE customer-facing email per inbound message — a booking gets exactly one booking_confirmation (never also a quote); an inquiry gets exactly one quote. If you have ALREADY sent the customer their reply, do NOT send another email — your only remaining steps are recording (create_inquiry/create_quote) and mark_email_done, then STOP.";

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

=== WORK IN A READ → ACT → VERIFY CYCLE (one action at a time) ===
Operate strictly like this, repeating for every action:
1. READ: call read_rules (or re-read the MANDATORY RULES already in your instructions).
2. ACT: take exactly ONE action (one tool call that changes something — send, book, reschedule, cancel, record).
3. VERIFY: after the result comes back, confirm it complied with the rules. If it violated any rule, correct it before doing anything else.
4. Repeat from step 1 for the next action.
Never batch multiple changing actions without re-reading and verifying between them. After every tool result you will be reminded to do this — actually do it.

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
          enum: ["quote", "booking_confirmation", "missing_info", "reschedule", "cancellation"],
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
    name: "send_email",
    description: "Send an email immediately. Use threadId and replyToMessageId to reply within an existing thread.",
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
      "Create a booking. Re-checks the slot is free, takes price/duration from the catalog by service_id, writes the booking to the database (source of truth) AND mirrors it to Google Calendar in one step. Returns confirmed details, or {success:false, alternatives} if the slot is taken. Call find_or_create_client first for clientId, and get_availability to pick a free startTime. Do NOT call create_booking_record after this — it already records to the database.",
    input_schema: {
      type: "object" as const,
      properties: {
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
      required: ["clientId", "serviceId", "date", "startTime", "address"],
    },
  },
  {
    name: "update_booking",
    description: "Update an existing calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        eventId: { type: "string" },
        summary: { type: "string" },
        startTime: { type: "string" },
        endTime: { type: "string" },
        location: { type: "string" },
        description: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel/delete a calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        eventId: { type: "string" },
      },
      required: ["eventId"],
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
  accessToken: string
): Promise<string> {
  try {
    switch (toolName) {
      case "read_rules": {
        return loadRules();
      }
      case "list_services": {
        return JSON.stringify(catalog.listServices(), null, 2);
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
        });
        return JSON.stringify({ success: true, quoteId: q.id, price: svc.price });
      }
      case "compose_and_send": {
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
        const sent = await gmail.sendEmail(accessToken, input.to, built.subject, built.body, input.cc, input.replyToMessageId, input.threadId);
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
      case "send_email": {
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
      case "update_booking": {
        const updated = await calendar.updateEvent(accessToken, input.eventId, {
          summary: input.summary,
          startTime: input.startTime,
          endTime: input.endTime,
          location: input.location,
          description: input.description,
        });
        await appendOperation({
          type: "booking_updated",
          calendarEventId: input.eventId,
          details: `Updated booking: ${input.eventId}`,
          verified: true,
        });
        return JSON.stringify({ success: true, eventId: updated.id });
      }
      case "cancel_booking": {
        await calendar.deleteEvent(accessToken, input.eventId);
        await appendOperation({
          type: "booking_cancelled",
          calendarEventId: input.eventId,
          details: `Cancelled booking: ${input.eventId}`,
          verified: true,
        });
        return JSON.stringify({ success: true });
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
        return JSON.stringify({ processed: await isEmailProcessed(input.messageId) });
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

// --- Main Automation Cycle ---
export async function runAutomationCycle(accessToken: string): Promise<{
  processed: number;
  actions: string[];
  errors: string[];
}> {
  const actions: string[] = [];
  const errors: string[] = [];

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
1. Call check_already_processed first
2. If not processed: classify it, execute the workflow, log operations, mark done
3. If already processed: skip it

EMAILS TO PROCESS:

${emailSummaries}`;

    // Run the AI with tool loop
    const systemPrompt = await buildAutomationPrompt();
    let currentMessages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    for (let i = 0; i < 40; i++) {
      const response = await client.messages.create({
        model: BUSINESS.ai.model,
        max_tokens: 4096,
        temperature: 0,
        system: systemPrompt,
        tools: AUTOMATION_TOOLS,
        messages: currentMessages,
      });

      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      const textBlocks = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as any).text);

      if (textBlocks.length > 0) {
        actions.push(...textBlocks);
      }

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        break;
      }

      currentMessages.push({ role: "assistant", content: response.content });

      const toolResults: any[] = [];
      for (const tool of toolUseBlocks) {
        const t = tool as any;
        const result = await executeTool(t.name, t.input, accessToken);
        toolResults.push({
          type: "tool_result",
          tool_use_id: t.id,
          content: result,
        });
        actions.push(`Tool: ${t.name}(${JSON.stringify(t.input).slice(0, 100)})`);
      }

      toolResults.push({ type: "text", text: RULE_CHECK });

      currentMessages.push({ role: "user", content: toolResults });
    }

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
      if (await isEmailProcessed(id)) continue;
      const msg = await gmail.getMessage(accessToken, id);
      const labels = (msg as any).labelIds || [];
      if (labels.includes("SENT") || labels.includes("DRAFT")) continue;
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
1. Call check_already_processed first
2. If not processed: classify it, execute the workflow, log operations, mark done
3. If already processed: skip it

EMAILS TO PROCESS:

${emailSummaries}`;

  const systemPrompt = await buildAutomationPrompt();
  let currentMessages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  try {
    for (let i = 0; i < 40; i++) {
      const response = await client.messages.create({
        model: BUSINESS.ai.model,
        max_tokens: 4096,
        temperature: 0,
        system: systemPrompt,
        tools: AUTOMATION_TOOLS,
        messages: currentMessages,
      });

      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      const textBlocks = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as any).text);
      if (textBlocks.length > 0) actions.push(...textBlocks);

      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") break;

      currentMessages.push({ role: "assistant", content: response.content });
      const toolResults: any[] = [];
      for (const tool of toolUseBlocks) {
        const t = tool as any;
        const result = await executeTool(t.name, t.input, accessToken);
        toolResults.push({ type: "tool_result", tool_use_id: t.id, content: result });
        actions.push(`Tool: ${t.name}(${JSON.stringify(t.input).slice(0, 100)})`);
      }
      toolResults.push({ type: "text", text: RULE_CHECK });
      currentMessages.push({ role: "user", content: toolResults });
    }
  } catch (err: any) {
    errors.push(err.message || String(err));
  }

  return { processed: unprocessed.length, actions, errors };
}
