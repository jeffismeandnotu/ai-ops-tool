import Anthropic from "@anthropic-ai/sdk";
import { BUSINESS } from "@/config/business";
import * as gmail from "@/lib/gmail";
import * as calendar from "@/lib/calendar";
import * as clientsDb from "@/lib/clients-db";
import * as fs from "fs";
import * as path from "path";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// --- Tool Definitions ---
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_emails",
    description:
      "Search Gmail for emails matching a query. Use Gmail query syntax.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            'Gmail search query (e.g., "from:client@example.com newer_than:7d")',
        },
        maxResults: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read the full content of an email thread by its thread ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Gmail thread ID" },
      },
      required: ["threadId"],
    },
  },
  {
    name: "get_recent_emails",
    description:
      "Get the most recent emails from the inbox (excluding promotions/social).",
    input_schema: {
      type: "object" as const,
      properties: {
        maxResults: {
          type: "number",
          description: "Number of emails to fetch (default 10)",
        },
      },
      required: [],
    },
  },
  {
    name: "draft_email",
    description:
      "Create an email draft. Does NOT send — creates a draft for review.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses",
        },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body text" },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "send_email",
    description: "Send an email immediately. Use threadId and replyToMessageId to reply within an existing thread.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses",
        },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body text" },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses",
        },
        threadId: { type: "string", description: "Gmail thread ID to reply in the same thread" },
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
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD)",
        },
        endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "find_available_slots",
    description:
      "Find available time slots on a specific date for a given service duration.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "Date (YYYY-MM-DD)" },
        durationMinutes: {
          type: "number",
          description: "Duration of the service in minutes",
        },
      },
      required: ["date", "durationMinutes"],
    },
  },
  {
    name: "create_booking",
    description:
      "Create a calendar event for a cleaning booking. Include client name, service, and location.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description:
            'Event title (e.g., "Regular Clean — Jane Smith")',
        },
        description: {
          type: "string",
          description: "Event description with booking details",
        },
        location: { type: "string", description: "Service address" },
        startTime: {
          type: "string",
          description: "Start time (ISO 8601)",
        },
        endTime: { type: "string", description: "End time (ISO 8601)" },
        attendeeEmails: {
          type: "array",
          items: { type: "string" },
          description: "Attendee emails (employee, client)",
        },
        colorId: {
          type: "string",
          description: "Calendar color ID (1-11)",
        },
      },
      required: ["summary", "startTime", "endTime"],
    },
  },
  {
    name: "update_booking",
    description: "Update an existing calendar event/booking.",
    input_schema: {
      type: "object" as const,
      properties: {
        eventId: { type: "string", description: "Calendar event ID" },
        summary: { type: "string", description: "New title" },
        startTime: { type: "string", description: "New start time (ISO)" },
        endTime: { type: "string", description: "New end time (ISO)" },
        location: { type: "string", description: "New location" },
        description: { type: "string", description: "New description" },
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
        eventId: { type: "string", description: "Calendar event ID to cancel" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "get_business_info",
    description:
      "Get business configuration: services, prices, employees, working hours.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "find_or_create_client",
    description: "Look up a client by email. Returns their record and booking history, or creates a new record. Call FIRST for every client interaction.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        postalCode: { type: "string" },
      },
      required: ["email"],
    },
  },
  {
    name: "create_booking_record",
    description: "Store a booking in the database after creating the calendar event.",
    input_schema: {
      type: "object" as const,
      properties: {
        clientId: { type: "string" },
        serviceId: { type: "string" },
        serviceName: { type: "string" },
        price: { type: "number" },
        date: { type: "string" },
        time: { type: "string" },
        duration: { type: "number" },
        address: { type: "string" },
        employeeName: { type: "string" },
        calendarEventId: { type: "string" },
        notes: { type: "string" },
      },
      required: ["clientId", "serviceId", "serviceName", "price", "date", "time", "duration", "address"],
    },
  },
  {
    name: "get_client_history",
    description: "Get a client's booking history, total spent, and visit count.",
    input_schema: {
      type: "object" as const,
      properties: { email: { type: "string" } },
      required: ["email"],
    },
  },
  {
    name: "update_client",
    description: "Update client info when you learn new details.",
    input_schema: {
      type: "object" as const,
      properties: {
        clientId: { type: "string" },
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
];

// --- Tool Executor ---
async function executeTool(
  toolName: string,
  input: any,
  accessToken: string
): Promise<string> {
  try {
    switch (toolName) {
      case "search_emails": {
        const threads = await gmail.searchEmails(
          accessToken,
          input.query,
          input.maxResults || 10
        );
        return JSON.stringify(threads.slice(0, 10), null, 2);
      }
      case "read_email": {
        const thread = await gmail.getThread(accessToken, input.threadId);
        return JSON.stringify(thread, null, 2);
      }
      case "get_recent_emails": {
        const emails = await gmail.getRecentEmails(
          accessToken,
          input.maxResults || 10
        );
        return JSON.stringify(emails, null, 2);
      }
      case "draft_email": {
        const draft = await gmail.createDraft(
          accessToken,
          input.to,
          input.subject,
          input.body,
          input.cc,
          input.replyToMessageId,
          input.threadId
        );
        return JSON.stringify({
          success: true,
          draftId: draft.id,
          message: "Draft created. Review in Gmail before sending.",
        });
      }
      case "send_email": {
        const sent = await gmail.sendEmail(
          accessToken,
          input.to,
          input.subject,
          input.body,
          input.cc,
          input.replyToMessageId,
          input.threadId
        );
        return JSON.stringify({
          success: true,
          messageId: sent.id,
          threadId: sent.threadId,
          message: "Email sent successfully.",
        });
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
            description: e.description?.slice(0, 200),
          })),
          null,
          2
        );
      }
      case "find_available_slots": {
        const slots = await calendar.findFreeSlots(
          accessToken,
          input.date,
          input.durationMinutes
        );
        return JSON.stringify(slots, null, 2);
      }
      case "create_booking": {
        const event = await calendar.createEvent(accessToken, {
          summary: input.summary,
          description: input.description,
          location: input.location,
          startTime: input.startTime,
          endTime: input.endTime,
          attendeeEmails: input.attendeeEmails,
          colorId: input.colorId,
          reminders: [
            { method: "email", minutes: 60 },
            { method: "popup", minutes: 30 },
          ],
        });
        return JSON.stringify({
          success: true,
          eventId: event.id,
          link: event.htmlLink,
          message: "Booking created on calendar.",
        });
      }
      case "update_booking": {
        const updated = await calendar.updateEvent(
          accessToken,
          input.eventId,
          {
            summary: input.summary,
            startTime: input.startTime,
            endTime: input.endTime,
            location: input.location,
            description: input.description,
          }
        );
        return JSON.stringify({
          success: true,
          eventId: updated.id,
          message: "Booking updated.",
        });
      }
      case "cancel_booking": {
        await calendar.deleteEvent(accessToken, input.eventId);
        return JSON.stringify({
          success: true,
          message: "Booking cancelled.",
        });
      }
      case "get_business_info": {
        return JSON.stringify(
          {
            name: BUSINESS.name,
            services: BUSINESS.services,
            employees: BUSINESS.employees.map((e) => ({
              name: e.name,
              email: e.email,
              specialties: e.specialties,
            })),
            workingHours: BUSINESS.calendar.workingHours,
            workingDays: BUSINESS.calendar.workingDays,
            bufferMinutes: BUSINESS.calendar.bufferMinutes,
          },
          null,
          2
        );
      }
      case "find_or_create_client": {
        const result = await clientsDb.findOrCreateClient({
          email: input.email,
          name: input.name,
          phone: input.phone,
          address: input.address,
          city: input.city,
          postalCode: input.postalCode,
          source: "chat",
        });
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
        const booking = await clientsDb.createBooking({
          clientId: input.clientId,
          serviceId: input.serviceId,
          serviceName: input.serviceName,
          price: input.price,
          date: input.date,
          time: input.time,
          duration: input.duration,
          address: input.address,
          employeeName: input.employeeName,
          calendarEventId: input.calendarEventId,
          notes: input.notes,
        });
        return JSON.stringify({ success: true, bookingId: booking.id });
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
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || String(err) });
  }
}

// --- Build System Prompt ---
function buildSystemPrompt(): string {
  let prompt = BUSINESS.ai.systemPrompt;
  prompt = prompt.replace(/\{\{businessName\}\}/g, BUSINESS.name);
  prompt = prompt.replace(
    /\{\{bufferMinutes\}\}/g,
    String(BUSINESS.calendar.bufferMinutes)
  );
  prompt = prompt.replace(
    /\{\{workingHours\.start\}\}/g,
    BUSINESS.calendar.workingHours.start
  );
  prompt = prompt.replace(
    /\{\{workingHours\.end\}\}/g,
    BUSINESS.calendar.workingHours.end
  );
  prompt = prompt.replace(
    /\{\{workingDays\}\}/g,
    BUSINESS.calendar.workingDays.join(", ")
  );

  // Load rules file
  try {
    const rulesPath = path.join(process.cwd(), "src", "config", "RULES.md");
    const rules = fs.readFileSync(rulesPath, "utf-8");
    prompt += `\n\n=== MANDATORY RULES ===\n${rules}\n=== END RULES ===`;
  } catch {}

  prompt += `\n\nToday's date: ${new Date().toISOString().split("T")[0]}`;
  prompt += `\nTimezone: ${BUSINESS.timezone}`;
  prompt += `\nServices: ${BUSINESS.services.map((s) => `${s.name} ($${s.price}, ${s.duration}min)`).join("; ")}`;
  prompt += `\nOwner: ${BUSINESS.owner.name} <${BUSINESS.owner.email}>`;

  return prompt;
}

// --- Main Chat Function ---
export async function chat(
  messages: { role: "user" | "assistant"; content: string }[],
  accessToken: string
): Promise<string> {
  const systemPrompt = buildSystemPrompt();

  let currentMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Tool use loop — keep going until the AI gives a final text response
  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: BUSINESS.ai.model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
      messages: currentMessages,
    });

    // Collect all text and tool use blocks
    const textBlocks = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("\n");

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    // If no tool use, return the text response
    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      if (textBlocks) return textBlocks;
      return "Done.";
    }

    // Execute tools and add results
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
    }

    currentMessages.push({ role: "user", content: toolResults });
  }

  return "Completed operations.";
}
