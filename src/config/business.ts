// ============================================================
// BUSINESS CONFIGURATION — Glow Cleaning Services
// ============================================================
// All business-specific details live here.
// Change ANY value to customize for a different client.
// ============================================================

export const BUSINESS = {
  // --- Company ---
  name: "Glow Cleaning Services",
  tagline: "Professional Cleaning Services — Whistler & Sea to Sky",
  website: "https://www.glowcleaningservices.ca",
  timezone: "America/Vancouver",
  currency: "CAD",
  locale: "en-CA",
  phone: "604-902-0399",

  // --- People ---
  owner: {
    name: "Micky",
    email: "aryanraman777@gmail.com",
    phone: "604-902-0399",
    role: "owner" as const,
  },

  // Administrator (AI role)
  administrator: {
    name: "Glow Cleaning Administrator",
    signOff: "Glow Cleaning Services",
  },

  employees: [
    {
      name: "Team A",
      email: "", // fill before demo
      phone: "",
      role: "cleaner" as const,
      specialties: ["residential", "vacation-rental", "airbnb"],
      availability: {
        monday: { start: "08:00", end: "17:00" },
        tuesday: { start: "08:00", end: "17:00" },
        wednesday: { start: "08:00", end: "17:00" },
        thursday: { start: "08:00", end: "17:00" },
        friday: { start: "08:00", end: "17:00" },
        saturday: { start: "09:00", end: "15:00" },
        sunday: null,
      },
    },
    {
      name: "Team B",
      email: "", // fill before demo
      phone: "",
      role: "cleaner" as const,
      specialties: ["commercial", "deep-clean", "post-construction"],
      availability: {
        monday: { start: "08:00", end: "17:00" },
        tuesday: { start: "08:00", end: "17:00" },
        wednesday: { start: "08:00", end: "17:00" },
        thursday: { start: "08:00", end: "17:00" },
        friday: { start: "08:00", end: "17:00" },
        saturday: null,
        sunday: null,
      },
    },
  ],

  // --- Services (from glowcleaningservices.ca) ---
  // Prices are quote-based on their site. These are Whistler-market estimates.
  // Matt can adjust before going live.
  services: [
    {
      id: "regular",
      name: "Regular Clean",
      duration: 120,
      price: 180,
      description: "Standard cleaning for vacation rentals, Airbnb, residential, and common areas. Includes dusting, vacuuming, mopping, bathroom and kitchen cleaning.",
    },
    {
      id: "deep",
      name: "Deep Clean",
      duration: 240,
      price: 350,
      description: "Thorough deep cleaning for vacation rentals, Airbnb, and residential properties. Includes appliances, baseboards, inside cabinets, and detailed sanitization.",
    },
    {
      id: "turnover",
      name: "Vacation Rental Turnover",
      duration: 150,
      price: 200,
      description: "Quick turnover clean between guest stays. Linens, restocking, garbage, full bathroom and kitchen reset. Ready for next guest arrival.",
    },
    {
      id: "post-construction",
      name: "Post-Construction Clean",
      duration: 360,
      price: 500,
      description: "Prepare properties for client delivery after renovations. Dust removal, debris cleanup, window cleaning, surface polishing.",
    },
    {
      id: "pressure-washing",
      name: "Pressure Washing",
      duration: 180,
      price: 300,
      description: "High-powered cleaning for driveways, common areas, decks, and sidings. Removes dirt, grime, moss, and stains.",
    },
    {
      id: "carpet",
      name: "Carpet Cleaning",
      duration: 120,
      price: 200,
      description: "Professional carpet cleaning to remove dirt, stains, and allergens. Leaves carpets fresh, clean, and like-new.",
    },
    {
      id: "laundry",
      name: "Laundry Service",
      duration: 90,
      price: 80,
      description: "Laundry service for vacation rentals, Airbnb, and residential. Wash, dry, fold, and restock linens.",
    },
    {
      id: "commercial",
      name: "Commercial / Office Clean",
      duration: 180,
      price: 250,
      description: "Government offices, commercial properties, and shared workspaces. Includes all surfaces, restrooms, kitchenettes, and common areas.",
    },
  ],

  // --- Email Templates ---
  emailTemplates: {
    bookingConfirmation: {
      subject: "Booking Confirmed — {{service}} on {{date}}",
      body: `Hi {{clientName}},

Your {{service}} is confirmed for {{date}} at {{time}}.

Address: {{address}}
Duration: {{duration}}
Total: \${{price}} CAD

Your cleaning team will arrive on time. Please ensure access to the property.

If you need to make any changes, just reply to this email or call us at 604-902-0399.

{{signOff}}`,
    },

    reminder: {
      subject: "Reminder: {{service}} Tomorrow at {{time}}",
      body: `Hi {{clientName}},

Quick reminder — your {{service}} is tomorrow, {{date}} at {{time}}.

Address: {{address}}

Please make sure we can access the property. If anything's changed, reply to this email.

See you tomorrow,
{{signOff}}`,
    },

    employeeSchedule: {
      subject: "Job Details — {{date}} at {{time}}",
      body: `Hi,

You have a {{service}} scheduled:

Date: {{date}} at {{time}}
Address: {{address}}
Client: {{clientName}}
Duration: {{duration}}
Notes: {{notes}}

Please confirm by replying.

{{signOff}}`,
    },

    cancellation: {
      subject: "Booking Cancelled — {{service}} on {{date}}",
      body: `Hi {{clientName}},

Your {{service}} on {{date}} at {{time}} has been cancelled.

If you'd like to rebook, just reply to this email or call us at 604-902-0399.

{{signOff}}`,
    },

    ownerNotification: {
      subject: "{{notificationType}}: {{clientName}} — {{service}}",
      body: `Matt,

{{details}}

Client: {{clientName}} ({{clientEmail}})
Service: {{service}}
Date: {{date}} at {{time}}
Address: {{address}}
Price: \${{price}} CAD

{{signOff}}`,
    },
  },

  // --- Calendar Settings ---
  calendar: {
    bufferMinutes: 30,
    workingHours: { start: "08:00", end: "17:00" },
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
    colorCodes: {
      regular: "9",
      deep: "5",
      turnover: "10",
      "post-construction": "11",
      "pressure-washing": "7",
      carpet: "3",
      laundry: "2",
      commercial: "1",
    } as Record<string, string>,
  },

  // --- AI Behavior ---
  ai: {
    model: "claude-sonnet-4-20250514",
    systemPrompt: `You are the administrator for {{businessName}}, a professional cleaning service based in Whistler and the Sea to Sky corridor.

Your role:
1. Read and understand incoming emails from clients and property managers
2. Draft and send appropriate responses
3. Manage the Google Calendar — check availability, create/update/cancel appointments
4. Keep Matt (the owner) informed of all bookings, cancellations, and issues
5. Store client information in the database for every interaction

You handle: vacation rentals, Airbnb turnovers, residential, commercial, post-construction, pressure washing, carpet cleaning, and laundry.

When you receive an email:
1. Extract the sender's email address
2. Call find_or_create_client to get or create their record
3. If any required fields are missing (name, address for bookings), ask for them
4. Classify the email and execute the workflow
5. After booking, call create_booking_record to store it in the database
6. For returning clients, reference their history to personalize the response

Business context:
- Based in Whistler, BC — many clients are vacation rental and Airbnb property managers
- Turnover cleans between guest stays are time-sensitive
- Many properties require supply restocking (linens, toiletries)
- Operating hours: 8am-5pm Mon-Fri, 9am-3pm Saturday
- {{bufferMinutes}}-minute buffer between appointments
- Always check calendar before confirming
- CC Matt on all bookings and cancellations`,
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
  date: string;
  time: string;
  duration: number;
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

  const businessVars: Record<string, string> = {
    businessName: BUSINESS.name,
    businessPhone: BUSINESS.phone,
    currency: BUSINESS.currency,
    bufferMinutes: String(BUSINESS.calendar.bufferMinutes),
    signOff: BUSINESS.administrator.signOff,
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
export function getService(id: string) {
  return BUSINESS.services.find((s) => s.id === id);
}

export function findServiceByName(name: string) {
  const lower = name.toLowerCase();
  return BUSINESS.services.find(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      s.id.toLowerCase().includes(lower) ||
      s.description.toLowerCase().includes(lower)
  );
}

export function getEmployee(email: string) {
  return BUSINESS.employees.find((e) => e.email === email);
}
