import { neon } from "@neondatabase/serverless";

// ============================================================
// CLIENT DATABASE — Neon Postgres
// ============================================================
// Stores client records, booking history, and email log.
// AI tools call these functions to read/write client data.
// All tables auto-created on first access (idempotent).
// ============================================================

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

// --- Types ---
export interface Client {
  id: string;
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  notes: string | null;
  source: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  pets: string | null;
  parking: string | null;
  access_notes: string | null;
  service_interest: string | null;
  recurring: string | null;
  preferred_times: string | null;
  special_instructions: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  client_id: string;
  service_id: string;
  service_name: string;
  price: number;
  date: string;
  time: string;
  duration: number;
  address: string;
  status: string;
  employee_name: string | null;
  employee_email: string | null;
  calendar_event_id: string | null;
  notes: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailLogEntry {
  id: string;
  gmail_message_id: string | null;
  thread_id: string | null;
  direction: string;
  from_email: string;
  to_emails: string;
  subject: string;
  classification: string | null;
  client_id: string | null;
  booking_id: string | null;
  processed_at: string;
  action_taken: string | null;
}

// --- Init tables ---
let _tablesReady = false;
async function ensureClientTables() {
  if (_tablesReady) return;
  const sql = getDb();

  await sql`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    postal_code TEXT,
    notes TEXT,
    source TEXT DEFAULT 'email',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id),
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    date DATE NOT NULL,
    time TEXT NOT NULL,
    duration INTEGER NOT NULL,
    address TEXT NOT NULL,
    status TEXT DEFAULT 'confirmed',
    employee_name TEXT,
    employee_email TEXT,
    calendar_event_id TEXT,
    notes TEXT,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS email_log (
    id TEXT PRIMARY KEY,
    gmail_message_id TEXT,
    thread_id TEXT,
    direction TEXT NOT NULL,
    from_email TEXT NOT NULL,
    to_emails TEXT NOT NULL,
    subject TEXT NOT NULL,
    classification TEXT,
    client_id TEXT,
    booking_id TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    action_taken TEXT
  )`;

  await sql`CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    thread_id TEXT,
    gmail_message_id TEXT,
    client_id TEXT REFERENCES clients(id),
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    summary TEXT,
    requested_service_id TEXT,
    requested_date TEXT,
    requested_window TEXT,
    address TEXT,
    raw_excerpt TEXT,
    confidence NUMERIC(4,3),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    inquiry_id TEXT,
    client_id TEXT REFERENCES clients(id),
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    currency TEXT DEFAULT 'CAD',
    valid_until DATE,
    status TEXT NOT NULL DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source_message_id TEXT`;
  await sql`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_email TEXT`;
  await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE`;

  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS property_type TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS bedrooms INT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS bathrooms INT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS pets TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS parking TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS access_notes TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_interest TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS recurring TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_times TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS special_instructions TEXT`;
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ`;

  _tablesReady = true;
}

// --- Client Operations ---

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function findOrCreateClient(data: {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  source?: string;
}): Promise<{ client: Client; created: boolean; missingFields: string[] }> {
  await ensureClientTables();
  const sql = getDb();

  // Try to find existing client by email
  const existing = await sql`SELECT * FROM clients WHERE LOWER(email) = LOWER(${data.email}) LIMIT 1`;

  if (existing.length > 0) {
    const client = existing[0] as unknown as Client;

    // Update any new fields we didn't have before
    const updates: Record<string, string | null> = {};
    if (data.phone && !client.phone) updates.phone = data.phone;
    if (data.address && !client.address) updates.address = data.address;
    if (data.city && !client.city) updates.city = data.city;
    if (data.postalCode && !client.postal_code) updates.postal_code = data.postalCode;
    if (data.firstName && !client.first_name) updates.first_name = data.firstName;
    if (data.lastName && !client.last_name) updates.last_name = data.lastName;

    if (Object.keys(updates).length > 0) {
      // Update with new info
      await sql`UPDATE clients SET
        phone = COALESCE(${updates.phone || null}, phone),
        address = COALESCE(${updates.address || null}, address),
        city = COALESCE(${updates.city || null}, city),
        postal_code = COALESCE(${updates.postal_code || null}, postal_code),
        first_name = COALESCE(${updates.first_name || null}, first_name),
        last_name = COALESCE(${updates.last_name || null}, last_name),
        updated_at = NOW()
        WHERE id = ${client.id}`;
    }

    // Check what's still missing
    const missingFields: string[] = [];
    if (!client.phone && !data.phone) missingFields.push("phone");
    if (!client.address && !data.address) missingFields.push("address");
    if (!client.name && !data.name) missingFields.push("name");

    // Refresh client data
    const refreshed = await sql`SELECT * FROM clients WHERE id = ${client.id}`;
    return { client: refreshed[0] as unknown as Client, created: false, missingFields };
  }

  // Create new client
  const id = genId("cli");
  const name = data.name || [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email.split("@")[0];

  await sql`INSERT INTO clients (id, email, name, first_name, last_name, phone, address, city, postal_code, source)
    VALUES (${id}, ${data.email}, ${name}, ${data.firstName || null}, ${data.lastName || null}, ${data.phone || null}, ${data.address || null}, ${data.city || null}, ${data.postalCode || null}, ${data.source || "email"})`;

  const created = await sql`SELECT * FROM clients WHERE id = ${id}`;

  const missingFields: string[] = [];
  if (!data.phone) missingFields.push("phone");
  if (!data.address) missingFields.push("address");
  if (!data.name && !data.firstName) missingFields.push("name");

  return { client: created[0] as unknown as Client, created: true, missingFields };
}

export async function updateClient(clientId: string, data: {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  notes?: string;
}): Promise<Client> {
  await ensureClientTables();
  const sql = getDb();

  await sql`UPDATE clients SET
    name = COALESCE(${data.name || null}, name),
    phone = COALESCE(${data.phone || null}, phone),
    address = COALESCE(${data.address || null}, address),
    city = COALESCE(${data.city || null}, city),
    postal_code = COALESCE(${data.postalCode || null}, postal_code),
    notes = COALESCE(${data.notes || null}, notes),
    updated_at = NOW()
    WHERE id = ${clientId}`;

  const rows = await sql`SELECT * FROM clients WHERE id = ${clientId}`;
  return rows[0] as unknown as Client;
}

export async function getClientByEmail(email: string): Promise<Client | null> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM clients WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  return rows.length > 0 ? (rows[0] as unknown as Client) : null;
}

// --- Booking Operations ---

export async function createBooking(data: {
  clientId: string;
  serviceId: string;
  serviceName: string;
  price: number;
  date: string;
  time: string;
  duration: number;
  address: string;
  employeeName?: string;
  employeeEmail?: string;
  calendarEventId?: string;
  notes?: string;
}): Promise<Booking> {
  await ensureClientTables();
  const sql = getDb();
  const id = genId("bk");

  await sql`INSERT INTO bookings (id, client_id, service_id, service_name, price, date, time, duration, address, employee_name, employee_email, calendar_event_id, notes)
    VALUES (${id}, ${data.clientId}, ${data.serviceId}, ${data.serviceName}, ${data.price}, ${data.date}, ${data.time}, ${data.duration}, ${data.address}, ${data.employeeName || null}, ${data.employeeEmail || null}, ${data.calendarEventId || null}, ${data.notes || null})`;

  const rows = await sql`SELECT * FROM bookings WHERE id = ${id}`;
  return rows[0] as unknown as Booking;
}

export async function updateBookingStatus(bookingId: string, status: string, cancelReason?: string): Promise<void> {
  await ensureClientTables();
  const sql = getDb();
  await sql`UPDATE bookings SET status = ${status}, cancel_reason = ${cancelReason || null}, updated_at = NOW() WHERE id = ${bookingId}`;
}

export async function getClientBookings(clientId: string): Promise<Booking[]> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM bookings WHERE client_id = ${clientId} ORDER BY date DESC LIMIT 50`;
  return rows as unknown as Booking[];
}

export async function getBookingByCalendarEvent(calendarEventId: string): Promise<Booking | null> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM bookings WHERE calendar_event_id = ${calendarEventId} LIMIT 1`;
  return rows.length > 0 ? (rows[0] as unknown as Booking) : null;
}

// --- Email Log ---

export async function logEmail(data: {
  gmailMessageId?: string;
  threadId?: string;
  direction: "inbound" | "outbound";
  fromEmail: string;
  toEmails: string;
  subject: string;
  classification?: string;
  clientId?: string;
  bookingId?: string;
  actionTaken?: string;
}): Promise<void> {
  await ensureClientTables();
  const sql = getDb();
  const id = genId("em");

  await sql`INSERT INTO email_log (id, gmail_message_id, thread_id, direction, from_email, to_emails, subject, classification, client_id, booking_id, action_taken)
    VALUES (${id}, ${data.gmailMessageId || null}, ${data.threadId || null}, ${data.direction}, ${data.fromEmail}, ${data.toEmails}, ${data.subject}, ${data.classification || null}, ${data.clientId || null}, ${data.bookingId || null}, ${data.actionTaken || null})`;
}

// --- Client History (for AI personalization) ---

export async function getClientHistory(email: string): Promise<{
  client: Client | null;
  bookings: Booking[];
  totalSpent: number;
  bookingCount: number;
}> {
  await ensureClientTables();
  const sql = getDb();

  const clientRows = await sql`SELECT * FROM clients WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  if (clientRows.length === 0) {
    return { client: null, bookings: [], totalSpent: 0, bookingCount: 0 };
  }

  const client = clientRows[0] as unknown as Client;
  const bookings = await sql`SELECT * FROM bookings WHERE client_id = ${client.id} ORDER BY date DESC LIMIT 20`;
  const stats = await sql`SELECT COUNT(*) as cnt, COALESCE(SUM(price), 0) as total FROM bookings WHERE client_id = ${client.id} AND status != 'cancelled'`;

  return {
    client,
    bookings: bookings as unknown as Booking[],
    totalSpent: Number(stats[0]?.total || 0),
    bookingCount: Number(stats[0]?.cnt || 0),
  };
}

// --- Dashboard Queries ---

export async function getAllClients(): Promise<Client[]> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM clients ORDER BY created_at DESC LIMIT 200`;
  return rows as unknown as Client[];
}

export async function getUpcomingBookings(days: number = 7): Promise<(Booking & { client_name: string; client_email: string })[]> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT b.*, c.name as client_name, c.email as client_email
    FROM bookings b JOIN clients c ON b.client_id = c.id
    WHERE b.date >= CURRENT_DATE AND b.date <= CURRENT_DATE + ${days}
    AND b.status = 'confirmed'
    ORDER BY b.date, b.time`;
  return rows as any;
}

// ============================================================
// INQUIRIES — every inbound business email becomes a record
// ============================================================
export async function createInquiry(data: {
  threadId?: string;
  gmailMessageId?: string;
  clientId?: string;
  type: string;
  status?: string;
  summary?: string;
  requestedServiceId?: string;
  requestedDate?: string;
  requestedWindow?: string;
  address?: string;
  rawExcerpt?: string;
  confidence?: number;
}): Promise<{ id: string }> {
  await ensureClientTables();
  const sql = getDb();
  const id = genId("inq");
  await sql`INSERT INTO inquiries (id, thread_id, gmail_message_id, client_id, type, status, summary, requested_service_id, requested_date, requested_window, address, raw_excerpt, confidence)
    VALUES (${id}, ${data.threadId || null}, ${data.gmailMessageId || null}, ${data.clientId || null}, ${data.type}, ${data.status || "new"}, ${data.summary || null}, ${data.requestedServiceId || null}, ${data.requestedDate || null}, ${data.requestedWindow || null}, ${data.address || null}, ${(data.rawExcerpt || "").slice(0, 1000)}, ${data.confidence ?? null})`;
  return { id };
}

export async function updateInquiryStatus(
  inquiryId: string,
  status: string,
  summary?: string
): Promise<void> {
  await ensureClientTables();
  const sql = getDb();
  await sql`UPDATE inquiries SET status = ${status}, summary = COALESCE(${summary || null}, summary), updated_at = NOW() WHERE id = ${inquiryId}`;
}

export async function getOpenInquiryByThread(threadId: string): Promise<{ id: string; type: string; status: string } | null> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT id, type, status FROM inquiries WHERE thread_id = ${threadId} AND status NOT IN ('closed','escalated') ORDER BY created_at DESC LIMIT 1`;
  return rows.length ? (rows[0] as any) : null;
}

// ============================================================
// QUOTES — price locked from catalog at issue time
// ============================================================
export async function createQuote(data: {
  inquiryId?: string;
  clientId?: string;
  serviceId: string;
  serviceName: string;
  price: number;
  currency?: string;
  validUntil?: string;
  sourceMessageId?: string;
  customerEmail?: string;
}): Promise<{ id: string }> {
  await ensureClientTables();
  const sql = getDb();
  const id = genId("qt");
  await sql`INSERT INTO quotes (id, inquiry_id, client_id, service_id, service_name, price, currency, valid_until, status, source_message_id, customer_email)
    VALUES (${id}, ${data.inquiryId || null}, ${data.clientId || null}, ${data.serviceId}, ${data.serviceName}, ${data.price}, ${data.currency || "CAD"}, ${data.validUntil || null}, 'sent', ${data.sourceMessageId || null}, ${data.customerEmail || null})`;
  return { id };
}

// Has this client been sent a proposal/quote in a DIFFERENT inbound message?
// Matches by clientId OR customer email. Used to enforce: never book until the
// client confirms a prior proposal.
export async function hasPriorProposal(
  opts: { clientId?: string; email?: string },
  excludeMessageId?: string
): Promise<boolean> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT 1 FROM quotes
    WHERE source_message_id IS NOT NULL
    AND source_message_id <> ${excludeMessageId || ""}
    AND (
      (${opts.clientId || ""} <> '' AND client_id = ${opts.clientId || ""})
      OR (${opts.email || ""} <> '' AND LOWER(customer_email) = LOWER(${opts.email || ""}))
    )
    LIMIT 1`;
  return rows.length > 0;
}

// Bookings on a date (DB source of truth for "taken").
export async function getBookingsOnDate(date: string): Promise<Booking[]> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM bookings WHERE date = ${date} AND status != 'cancelled' ORDER BY time`;
  return rows as unknown as Booking[];
}

// Fetch one booking by id (for building confirmations from source of truth).
export async function getBookingById(bookingId: string): Promise<Booking | null> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM bookings WHERE id = ${bookingId} LIMIT 1`;
  return rows.length ? (rows[0] as unknown as Booking) : null;
}

// Confirmed, not-yet-reminded bookings in the next few days (reminder cron).
export async function getRemindableBookings(): Promise<
  Array<Booking & { client_email: string; client_name: string }>
> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT b.*, c.email AS client_email, c.name AS client_name
    FROM bookings b JOIN clients c ON c.id = b.client_id
    WHERE b.status = 'confirmed'
    AND COALESCE(b.reminder_sent, false) = false
    AND b.date >= CURRENT_DATE
    AND b.date <= CURRENT_DATE + INTERVAL '3 days'`;
  return rows as any;
}

export async function markReminderSent(bookingId: string): Promise<void> {
  await ensureClientTables();
  const sql = getDb();
  await sql`UPDATE bookings SET reminder_sent = true, updated_at = NOW() WHERE id = ${bookingId}`;
}

// Update editable booking fields (post-booking change). Returns the updated row.
export async function updateBookingFields(
  bookingId: string,
  fields: { address?: string; notes?: string }
): Promise<Booking | null> {
  await ensureClientTables();
  const sql = getDb();
  if (typeof fields.address === "string") {
    await sql`UPDATE bookings SET address = ${fields.address}, updated_at = NOW() WHERE id = ${bookingId}`;
  }
  if (typeof fields.notes === "string") {
    await sql`UPDATE bookings SET notes = ${fields.notes}, updated_at = NOW() WHERE id = ${bookingId}`;
  }
  return getBookingById(bookingId);
}

// Delete a client's future bookings AND quotes (test cleanup). Returns count removed.
export async function deleteFutureBookingsForEmail(email: string): Promise<number> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`DELETE FROM bookings
    WHERE date >= CURRENT_DATE
    AND client_id IN (SELECT id FROM clients WHERE LOWER(email) = LOWER(${email}))
    RETURNING id`;
  await sql`DELETE FROM quotes
    WHERE LOWER(customer_email) = LOWER(${email})
    OR client_id IN (SELECT id FROM clients WHERE LOWER(email) = LOWER(${email}))`;
  return rows.length;
}

// ============================================================
// CLIENT PROFILE — consolidated golden record
// ============================================================

export interface ClientProfile {
  client: Client;
  openInquiry: { id: string; type: string; status: string; requested_service_id: string | null } | null;
  latestQuote: { id: string; service_id: string; service_name: string; price: number; status: string } | null;
  activePhase: { thread_id: string; phase: number } | null;
  recentBookings: Booking[];
  totalSpent: number;
  bookingCount: number;
}

export async function getClientProfile(email: string): Promise<ClientProfile | null> {
  await ensureClientTables();
  const sql = getDb();

  const clientRows = await sql`SELECT * FROM clients WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
  if (!clientRows.length) return null;
  const client = clientRows[0] as unknown as Client;

  const inqRows = await sql`SELECT id, type, status, requested_service_id FROM inquiries
    WHERE client_id = ${client.id} AND status NOT IN ('closed','escalated')
    ORDER BY created_at DESC LIMIT 1`;
  const openInquiry = inqRows.length ? (inqRows[0] as any) : null;

  const qtRows = await sql`SELECT id, service_id, service_name, price, status FROM quotes
    WHERE client_id = ${client.id} ORDER BY created_at DESC LIMIT 1`;
  const latestQuote = qtRows.length ? (qtRows[0] as any) : null;

  const phRows = await sql`SELECT thread_id, phase FROM booking_phases
    WHERE thread_id IN (SELECT thread_id FROM inquiries WHERE client_id = ${client.id})
    AND phase < 3 ORDER BY updated_at DESC LIMIT 1`;
  const activePhase = phRows.length ? { thread_id: phRows[0].thread_id as string, phase: Number(phRows[0].phase) } : null;

  const bookingRows = await sql`SELECT * FROM bookings WHERE client_id = ${client.id} ORDER BY date DESC LIMIT 5`;
  const stats = await sql`SELECT COUNT(*) as cnt, COALESCE(SUM(price), 0) as total FROM bookings WHERE client_id = ${client.id} AND status != 'cancelled'`;

  return {
    client,
    openInquiry,
    latestQuote,
    activePhase,
    recentBookings: bookingRows as unknown as Booking[],
    totalSpent: Number(stats[0]?.total || 0),
    bookingCount: Number(stats[0]?.cnt || 0),
  };
}

const GATE_CODE_PATTERN = /\b(gate|door|lock|entry|access)\s*(code|pin|key|password)\s*[:=]?\s*\S+/i;

export async function mergeUpsertClient(
  email: string,
  fields: {
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    pets?: string;
    parking?: string;
    accessNotes?: string;
    serviceInterest?: string;
    recurring?: string;
    preferredTimes?: string;
    specialInstructions?: string;
  }
): Promise<Client> {
  await ensureClientTables();
  const sql = getDb();

  // Scrub gate/lock codes from access_notes
  let safeAccessNotes = fields.accessNotes || null;
  if (safeAccessNotes && GATE_CODE_PATTERN.test(safeAccessNotes)) {
    safeAccessNotes = "has gate/door code — see thread";
  }

  const existing = await sql`SELECT * FROM clients WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;

  if (existing.length > 0) {
    const old = existing[0] as unknown as Client;

    // Address history: if new address differs, append old to notes
    let notesAppend: string | null = null;
    if (fields.address && fields.address.trim() && old.address && old.address.trim()
        && fields.address.trim().toLowerCase() !== old.address.trim().toLowerCase()) {
      notesAppend = `Previous address (${new Date().toISOString().slice(0, 10)}): ${old.address}`;
    }

    const bedroomsStr = fields.bedrooms != null ? String(fields.bedrooms) : "";
    const bathroomsStr = fields.bathrooms != null ? String(fields.bathrooms) : "";

    await sql`UPDATE clients SET
      name = COALESCE(NULLIF(${fields.name || ""}, ''), name),
      first_name = COALESCE(NULLIF(${fields.firstName || ""}, ''), first_name),
      last_name = COALESCE(NULLIF(${fields.lastName || ""}, ''), last_name),
      phone = COALESCE(NULLIF(${fields.phone || ""}, ''), phone),
      address = COALESCE(NULLIF(${fields.address || ""}, ''), address),
      city = COALESCE(NULLIF(${fields.city || ""}, ''), city),
      postal_code = COALESCE(NULLIF(${fields.postalCode || ""}, ''), postal_code),
      property_type = COALESCE(NULLIF(${fields.propertyType || ""}, ''), property_type),
      bedrooms = COALESCE(NULLIF(${bedroomsStr}, '')::INT, bedrooms),
      bathrooms = COALESCE(NULLIF(${bathroomsStr}, '')::INT, bathrooms),
      pets = COALESCE(NULLIF(${fields.pets || ""}, ''), pets),
      parking = COALESCE(NULLIF(${fields.parking || ""}, ''), parking),
      access_notes = COALESCE(NULLIF(${safeAccessNotes || ""}, ''), access_notes),
      service_interest = COALESCE(NULLIF(${fields.serviceInterest || ""}, ''), service_interest),
      recurring = COALESCE(NULLIF(${fields.recurring || ""}, ''), recurring),
      preferred_times = COALESCE(NULLIF(${fields.preferredTimes || ""}, ''), preferred_times),
      special_instructions = COALESCE(NULLIF(${fields.specialInstructions || ""}, ''), special_instructions),
      notes = CASE WHEN ${notesAppend || ""} <> ''
        THEN COALESCE(notes || E'\n', '') || ${notesAppend || ""}
        ELSE notes END,
      last_contact_at = NOW(),
      updated_at = NOW()
      WHERE id = ${old.id}`;

    const refreshed = await sql`SELECT * FROM clients WHERE id = ${old.id}`;
    return refreshed[0] as unknown as Client;
  }

  // New client
  const id = genId("cli");
  const name = fields.name || [fields.firstName, fields.lastName].filter(Boolean).join(" ") || email.split("@")[0];

  const newBedroomsStr = fields.bedrooms != null ? String(fields.bedrooms) : null;
  const newBathroomsStr = fields.bathrooms != null ? String(fields.bathrooms) : null;

  await sql`INSERT INTO clients (id, email, name, first_name, last_name, phone, address, city, postal_code,
    property_type, bedrooms, bathrooms, pets, parking, access_notes, service_interest, recurring, preferred_times, special_instructions,
    source, last_contact_at)
    VALUES (${id}, ${email}, ${name}, ${fields.firstName || null}, ${fields.lastName || null}, ${fields.phone || null},
    ${fields.address || null}, ${fields.city || null}, ${fields.postalCode || null},
    ${fields.propertyType || null}, ${newBedroomsStr}::INT, ${newBathroomsStr}::INT,
    ${fields.pets || null}, ${fields.parking || null}, ${safeAccessNotes}, ${fields.serviceInterest || null},
    ${fields.recurring || null}, ${fields.preferredTimes || null}, ${fields.specialInstructions || null},
    'email', NOW())`;

  const created = await sql`SELECT * FROM clients WHERE id = ${id}`;
  return created[0] as unknown as Client;
}

export async function findClientByNameAndPhone(name: string, phone: string): Promise<Client | null> {
  await ensureClientTables();
  const sql = getDb();
  const rows = await sql`SELECT * FROM clients
    WHERE LOWER(name) = LOWER(${name}) AND phone = ${phone}
    LIMIT 1`;
  return rows.length ? (rows[0] as unknown as Client) : null;
}
