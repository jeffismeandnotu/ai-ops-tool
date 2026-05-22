// ============================================================
// BUSINESS CONFIGURATION
// ============================================================
// All business-specific details live here.
// Change ANY value to customize for a different client.
// Nothing else in the codebase needs to change.
// ============================================================

export const BUSINESS = {
  // --- Company ---
  name: "My Business",
  tagline: "Professional Cleaning Services",
  timezone: "America/Vancouver",
  currency: "CAD",
  locale: "en-CA",

  // --- People ---
  // Owner/manager who runs the business
  owner: {
    name: "Owner Name",
    email: "owner@example.com",
    phone: "+1-604-555-0001",
    role: "owner" as const,
  },

  // Employees / cleaners
  employees: [
    {
      name: "Employee 1",
      email: "employee1@example.com",
      phone: "+1-604-555-0002",
      role: "cleaner" as const,
      specialties: ["residential", "deep-clean"],
      availability: {
        monday: { start: "08:00", end: "17:00" },
        tuesday: { start: "08:00", end: "17:00" },
        wednesday: { start: "08:00", end: "17:00" },
        thursday: { start: "08:00", end: "17:00" },
        friday: { start: "08:00", end: "17:00" },
        saturday: null, // off
        sunday: null,
      },
    },
    // Add more employees as needed
  ],

  // --- Services ---
  services: [
    {
      id: "regular",
      name: "Regular Clean",
      duration: 120, // minutes
      price: 150, // CAD
      description: "Standard residential cleaning",
    },
    {
      id: "deep",
      name: "Deep Clean",
      duration: 240,
      price: 300,
      description: "Thorough deep cleaning including appliances",
    },
    {
      id: "moveout",
      name: "Move-Out Clean",
      duration: 360,
      price: 450,
      description: "Complete move-out cleaning for landlord inspection",
    },
    {
      id: "office",
      name: "Office Clean",
      duration: 180,
      price: 200,
      description: "Commercial office cleaning",
    },
  ],

  // --- Email Templates ---
  // These are the base templates. AI will personalize them.
  emailTemplates: {
    bookingConfirmation: {
      subject: "Booking Confirmed — {{service}} on {{date}}",
      body: `Hi {{clientName}},

Your {{service}} has been confirmed for {{date}} at {{time}}.

Your cleaner {{employeeName}} will arrive at your location at {{address}}.

Duration: approximately {{duration}}.
Total: \${{price}} {{currency}}.

If you need to reschedule, please reply to this email or call us at {{businessPhone}}.

Thank you for choosing {{businessName}}!

Best regards,
{{businessName}} Team`,
    },

    reminder: {
      subject: "Reminder: {{service}} Tomorrow at {{time}}",
      body: `Hi {{clientName}},

This is a friendly reminder that your {{service}} is scheduled for tomorrow, {{date}} at {{time}}.

Your cleaner {{employeeName}} will arrive at {{address}}.

Please ensure access to the property. If you need to make any changes, reply to this email.

See you tomorrow!
{{businessName}} Team`,
    },

    employeeSchedule: {
      subject: "Your Schedule for {{date}}",
      body: `Hi {{employeeName}},

Here is your schedule for {{date}}:

{{scheduleDetails}}

Please confirm by replying to this email.

Thanks,
{{businessName}} Management`,
    },

    followUp: {
      subject: "How was your cleaning? — {{businessName}}",
      body: `Hi {{clientName}},

We hope your {{service}} on {{date}} met your expectations!

If you have any feedback or would like to schedule your next cleaning, just reply to this email.

Thank you for your business!
{{businessName}} Team`,
    },

    reschedule: {
      subject: "Schedule Change — {{service}} moved to {{newDate}}",
      body: `Hi {{clientName}},

Your {{service}} has been rescheduled from {{oldDate}} to {{newDate}} at {{newTime}}.

Your cleaner will be {{employeeName}}.

If this doesn't work for you, please reply and we'll find another time.

Apologies for any inconvenience.
{{businessName}} Team`,
    },

    cancellation: {
      subject: "Booking Cancelled — {{service}} on {{date}}",
      body: `Hi {{clientName}},

Your {{service}} scheduled for {{date}} at {{time}} has been cancelled.

If you'd like to rebook, reply to this email or visit our booking page.

Thank you,
{{businessName}} Team`,
    },
  },

  // --- Calendar Settings ---
  calendar: {
    bufferMinutes: 30, // time between appointments
    workingHours: { start: "08:00", end: "18:00" },
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    colorCodes: {
      regular: "9", // Blueberry
      deep: "5", // Banana
      moveout: "11", // Tomato
      office: "7", // Peacock
    },
  },

  // --- AI Behavior ---
  ai: {
    model: "claude-sonnet-4-20250514",
    systemPrompt: `You are the AI operations assistant for {{businessName}}, a professional cleaning service.

Your role:
1. Read and understand incoming emails from clients, employees, and the manager
2. Draft appropriate responses based on the email templates and context
3. Manage the Google Calendar — check availability, create/update/cancel appointments
4. Send reminders for upcoming appointments
5. Notify the right people about schedule changes
6. Keep the manager informed of important updates

Business rules:
- Always check calendar availability before confirming a booking
- Include a {{bufferMinutes}}-minute buffer between appointments
- Working hours: {{workingHours.start}} to {{workingHours.end}}
- Working days: {{workingDays}}
- Always CC the manager on client-facing emails if it involves money or complaints
- Be professional, warm, and concise
- Use the client's first name
- Always include the full address and time in confirmations

When you receive an email:
1. Classify it: booking request, reschedule, cancellation, complaint, inquiry, or internal
2. Determine the appropriate action (draft email, create/update calendar event, notify someone)
3. Execute the action
4. Report what you did

You have access to Gmail (read, draft, label) and Google Calendar (create, update, list, find free time).`,
  },
};

// --- Types ---
export type ServiceId = (typeof BUSINESS.services)[number]["id"];
export type EmailTemplateKey = keyof typeof BUSINESS.emailTemplates;
export type EmployeeRole = "owner" | "cleaner" | "manager";

export interface Client {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export interface Booking {
  id?: string;
  client: Client;
  service: ServiceId;
  employee: string;
  date: string; // ISO
  time: string; // HH:mm
  duration: number; // minutes
  price: number;
  status: "confirmed" | "pending" | "cancelled" | "completed";
  calendarEventId?: string;
  notes?: string;
}

// --- Template Renderer ---
export function renderTemplate(
  templateKey: EmailTemplateKey,
  variables: Record<string, string>
): { subject: string; body: string } {
  const template = BUSINESS.emailTemplates[templateKey];
  let subject: string = template.subject;
  let body: string = template.body;

  // Replace business-level variables
  const businessVars: Record<string, string> = {
    businessName: BUSINESS.name,
    businessPhone: BUSINESS.owner.phone,
    currency: BUSINESS.currency,
    bufferMinutes: String(BUSINESS.calendar.bufferMinutes),
  };

  const allVars = { ...businessVars, ...variables };

  for (const [key, value] of Object.entries(allVars)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    subject = subject.replace(pattern, value);
    body = body.replace(pattern, value);
  }

  return { subject, body };
}

// --- Service Lookup ---
export function getService(id: ServiceId) {
  return BUSINESS.services.find((s) => s.id === id);
}

export function getEmployee(email: string) {
  return BUSINESS.employees.find((e) => e.email === email);
}
