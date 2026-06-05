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
  website: "",
  timezone: "America/Vancouver",
  currency: "CAD",
  locale: "en-CA",
  phone: "",

  // --- People ---
  owner: {
    name: "Micky",
    email: "aryanraman777@gmail.com",
    phone: "",
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

  // --- Services (Vancouver/Whistler market pricing, 2026) ---
  // Based on Vancouver avg: $40-60/hr, flat rates from market research.
  // Whistler premium ~20-30% above Vancouver metro.
  services: [
    {
      id: "regular",
      name: "Regular Clean",
      duration: 150, // 2.5 hrs avg for 2-3 bed
      price: 200,
      description: "Standard residential cleaning. Dusting, vacuuming, mopping, bathroom and kitchen sanitization. Ideal for regular upkeep of homes and rental units.",
    },
    {
      id: "deep",
      name: "Deep Clean",
      duration: 270, // 4.5 hrs
      price: 380,
      description: "Comprehensive deep cleaning including inside appliances, baseboards, door frames, inside cabinets, window tracks, and detailed sanitization. Recommended every 3-6 months.",
    },
    {
      id: "turnover",
      name: "Vacation Rental Turnover",
      duration: 150,
      price: 220,
      description: "Guest-ready turnover between stays. Full clean, linen change, restocking essentials, garbage removal, bathroom and kitchen reset. Ensures 5-star reviews.",
    },
    {
      id: "moveout",
      name: "Move-In / Move-Out Clean",
      duration: 300, // 5 hrs
      price: 450,
      description: "Thorough move-in or move-out cleaning for landlord inspection. Every surface, inside all appliances, closets, baseboards, windows. Helps recover damage deposits.",
    },
    {
      id: "post-construction",
      name: "Post-Construction Clean",
      duration: 360, // 6 hrs
      price: 550,
      description: "Construction dust removal, debris cleanup, surface polishing, window cleaning. Prepares newly built or renovated properties for occupancy.",
    },
    {
      id: "pressure-washing",
      name: "Pressure Washing",
      duration: 180,
      price: 320,
      description: "High-powered exterior cleaning for driveways, decks, sidings, patios, and common areas. Removes dirt, grime, moss, and seasonal buildup.",
    },
    {
      id: "carpet",
      name: "Carpet Cleaning",
      duration: 120,
      price: 220,
      description: "Professional carpet cleaning. Removes deep dirt, stains, and allergens. Hot water extraction method. Price per average-sized home — large homes quoted separately.",
    },
    {
      id: "laundry",
      name: "Laundry Service",
      duration: 90,
      price: 85,
      description: "Wash, dry, fold, and restock linens for vacation rentals and Airbnb properties. Per standard load of linens for a 2-3 bedroom unit.",
    },
    {
      id: "commercial",
      name: "Commercial / Office Clean",
      duration: 180,
      price: 280,
      description: "Offices, government buildings, and commercial spaces. All surfaces, restrooms, kitchenettes, common areas, and reception. Regular contracts available at reduced rates.",
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

If you need to make any changes, just reply to this email.

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

If you'd like to rebook, just reply to this email.

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

  // --- Pricing policy ---
  // Contract / volume pricing is a real, owner-approved FEATURE — never a
  // discount the AI invents. The AI offers it from this fixed rule and the
  // owner sets the actual rate.
  pricing: {
    contract: {
      enabled: true,
      // Signals in a customer email that mean "offer contract pricing".
      triggers: [
        "recurring", "weekly", "bi-weekly", "biweekly", "daily", "ongoing",
        "regular", "commercial", "office", "multiple", "several units",
        "contract", "monthly", "every week", "each week",
      ],
      // The EXACT line the AI uses. It never invents a contract number.
      line:
        "For recurring or commercial work we also offer custom contract pricing — I'll loop in our owner to put together a tailored rate for your schedule.",
      escalateToOwner: true,
    },
  },

  // --- Cancellation policy ---
  cancellation: {
    // Free cancellation/reschedule allowed via AI up to this many hours before.
    noticeHours: 24,
    // Within the notice window the AI does NOT cancel; it informs the customer
    // a fee applies and leaves it for the owner to handle.
    feeLine:
      "Since this is within 24 hours of your appointment, our cancellation policy means a cancellation fee may apply. Someone from the organization or our team will contact you shortly to confirm the details.",
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
4. Keep the owner informed of all bookings, cancellations, and issues
5. Store client information in the database for every interaction

You handle: vacation rentals, Airbnb turnovers, residential, commercial, post-construction, pressure washing, carpet cleaning, and laundry.

When you receive an email:
1. Extract the sender's email address
2. Call find_or_create_client to get or create their record
3. If any required fields are missing (name, address for bookings), ask for them
4. Classify the email and execute the workflow
5. After booking, call create_booking_record to store it in the database
6. For returning clients, reference their history to personalize the response

EMAIL SIGNING:
- NEVER sign emails with a person's name
- ALWAYS sign as: "Glow Cleaning Services" (business name only)
- You are the business, not a person

TIME SLOT RULES:
- When suggesting available times, offer VARIED slots across different times of day
- Example: "Monday at 9am, Tuesday at 1pm, Wednesday at 10:30am" — NOT all at 8am
- Spread suggestions across morning (8-11am) and afternoon (12-4pm)
- Check actual calendar availability before suggesting

Business context:
- Based in Whistler, BC — many clients are vacation rental and Airbnb property managers
- Turnover cleans between guest stays are time-sensitive
- Many properties require supply restocking (linens, toiletries)
- Operating hours: 8am-5pm Mon-Fri, 9am-3pm Saturday
- {{bufferMinutes}}-minute buffer between appointments
- Always check calendar before confirming
- CC the owner on all bookings and cancellations`,
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
