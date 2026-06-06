# Architecture — ai-ops-tool

Autonomous email operations platform for **Glow Cleaning Services** (Whistler & Sea to Sky, BC). An AI agent reads inbound Gmail, classifies intent, executes booking workflows, and replies — no human in the loop for routine operations.

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16 (App Router) | Deployed on Vercel, Fluid Compute |
| AI (primary) | Anthropic Claude (Haiku/Sonnet) | Native SDK with prompt caching |
| AI (fallback) | Any OpenAI-compatible (Gemini, DeepSeek) | Via `openai` SDK, configurable |
| Database | Neon Postgres (serverless) | All tables auto-created via `CREATE TABLE IF NOT EXISTS` |
| Email | Gmail API (googleapis) | Read, send, draft, label, watch |
| Calendar | Google Calendar API | Write-through mirror of bookings DB |
| Auth | NextAuth v4 + Google OAuth | Session-based for dashboard; refresh token stored in Neon |
| Frontend | React 19 + Tailwind CSS 4 | Single-page dashboard |

---

## High-Level Flow

```
                  Gmail Inbox
                      |
          +-----------+-----------+
          |                       |
    Pub/Sub Push             Cron (5min)
    /api/gmail/webhook       /api/cron/process
          |                       |
          +-------+-------+------+
                  |
           Rate Guards
    (per-sender / global / spend)
                  |
           Automation Engine
          (src/lib/automation.ts)
                  |
        +---------+---------+
        |                   |
   classify_email      scanRisk()
   (model intent)    (keyword backstop)
        |                   |
        +--------+----------+
                 |
         Phase State Machine
         (booking_phases table)
                 |
    +------------+------------+
    |            |            |
  Phase 1     Phase 2     Phase 3
  QUOTE       VALIDATE    BOOK
    |            |            |
  Templates   check_slot   createBookingGuarded()
  (code-      get_avail    -> DB + Calendar
   assembled)              -> confirmation email
```

---

## Inbound Paths

### 1. Gmail Pub/Sub Webhook (real-time)
```
POST /api/gmail/webhook?secret=<GMAIL_WEBHOOK_SECRET>
```
- Pub/Sub pushes within seconds of email arrival
- Payload: `{ message: { data: base64({ emailAddress, historyId }) } }`
- Diffs `historyId` against last stored value to get new message IDs
- Dedup via atomic `claimEmail()` (INSERT ... ON CONFLICT DO NOTHING)
- Self-renews the Gmail watch when within 24h of expiry

### Order of Operations (per inbound email)
1. Load client profile → inject `<customer_profile>` block (CONFIRMED/UNKNOWN)
2. Classify email (`classify_email`)
3. `find_or_create_client` with all extracted details → merges into DB, returns full profile
4. Only ask for UNKNOWN fields required for the current operation
5. Confirm CONFIRMED address before booking ("I have your address as X — still correct?")
6. Send exactly one customer reply → `mark_email_done`

### 2. Cron Polling (fallback)
```
GET /api/cron/process?secret=<CRON_SECRET>
```
- Scheduled every 5 minutes via Vercel cron
- Fetches unread emails, filters already-processed
- Same automation engine as the webhook path

---

## Automation Engine (`src/lib/automation.ts`)

The core ~2000-line module that orchestrates everything:

### System Prompt (`buildAutomationPrompt`)
- Business config, services, pricing, working hours
- 3-phase booking protocol
- Hard rules (one reply per inbound, template-only outbound, facts from tools)
- Profile rules: never re-ask CONFIRMED fields, confirm address before booking
- Escalation routing
- Anti-injection awareness (untrusted data delimiters)

### Tool Loop (`runAnthropicLoop` / `runAgentLoop`)
- Up to 40 iterations per inbound
- Prompt caching (`cache_control: ephemeral`) on system prompt + tools
- Retry on 429/529 with exponential backoff
- RULE_CHECK injected after every tool result
- Token/cost tracking via `ai_usage` table

### Client Profile (Golden Record)
Every inbound email triggers a pre-flight profile load via `buildProfileBlock()`:
1. Resolve sender → `findOrCreateClient` (create on first contact)
2. `getClientProfile()` returns full record: client fields + open inquiry + latest quote + active booking phase + recent bookings
3. Injected as `<customer_profile>` block with explicit CONFIRMED/UNKNOWN labels
4. `find_or_create_client` tool also merges new details and returns the full profile — agent sees known fields both in context AND tool results
5. Fields marked CONFIRMED are never re-asked; UNKNOWN fields may be asked if required for the operation

### Tool Executor (`executeTool`)
30+ tools with deterministic code guards:

| Guard | What it Blocks |
|-------|---------------|
| `isBusinessAddress()` | Emails to any glowcleaning address |
| `isAllowedRecipient()` | Emails to anyone not the original sender |
| `ctx.repliedTo` | Second email to same customer in one run |
| `ctx.destructiveActionDone` | Second booking/cancel/reschedule per inbound |
| `validateOutboundFacts()` | Emails with dollar amounts not in the catalog |
| Phase gate (`getPhase`) | Booking before client confirms (phase < 2) |
| Field completeness | Booking with missing required fields |
| `clientConfirmed` + `confirmationEvidence` | Booking without explicit client consent |

### Context Object (`ToolContext`)
```typescript
{
  repliedTo: Set<string>;           // emails already replied to this run
  messageId?: string;               // primary inbound message ID
  allowedRecipients: Set<string>;   // original sender(s) of inbound emails
  destructiveActionDone: boolean;   // one booking/cancel/reschedule per run
}
```

---

## 3-Phase Booking State Machine

Persisted in `booking_phases` table, keyed by Gmail thread ID.

```
Phase 0 (nothing yet)
    |
    v
Phase 1 — QUOTE
    Identify service, send price, ask for preferred day/time.
    No availability shown. No slots offered.
    Auto-marked when quote template is sent.
    |
    v
Phase 2 — COLLECT BOOKING DETAILS
    Retrieve stored intent (get_booking_intent) + extract new
    date/time/service from this message (set_booking_intent).
    Customer confirms service → send ONE consolidated checklist
    (missing_info template) with all 7 required booking fields:
    name, phone, service, address+code, date, time.
    Known fields pre-filled; unknowns blank. Never drips fields.
    Customer names a date+time → check_slot validates it.
    All fields present + slot free → mark phase 2.
    |
    v
Phase 3 — BOOK
    find_or_create_client → create_booking (DB + Calendar).
    clear_booking_intent → remove session intent.
    Send booking_confirmation template. Done.
```

Phase 1 records which message triggered it (`phase1_msg`). Phase 2 can only be marked on a *later* message — prevents booking on first contact.

### Booking Intent (24h Session Store)
Short-lived memory for in-flight date/time/service preferences. Stored in the `booking_intent` table (email PK, service_id, proposed_date, proposed_time, raw_quote, updated_at). Auto-expires after 24 hours; purged daily at 5 AM Vancouver via `/api/cron/purge-intent`.

- **`set_booking_intent`** — called whenever the customer mentions a date, time, or service. Merge semantics (COALESCE — non-null wins).
- **`get_booking_intent`** — called at the start of Phase 2 to recover preferences from prior messages within 24h.
- **`clear_booking_intent`** — called after successful booking to clean up.

Durable identity (name, phone, address) stays in the client record. Only ephemeral scheduling preferences live here.

### Required Booking Fields (Single Source of Truth)
`REQUIRED_BOOKING_FIELDS` constant in `automation.ts` — the canonical list of 7 fields required before a booking. Both `get_required_booking_fields` (tool response) and the `create_booking` guard (field completeness check) derive from this single constant.

| # | Field | Note |
|---|-------|------|
| 1 | `clientName` | the client's name |
| 2 | `clientEmail` | usually the sender's address |
| 3 | `clientPhone` | the client's phone number |
| 4 | `serviceId` | which service, from the catalog |
| 5 | `date` | YYYY-MM-DD |
| 6 | `startTime` | HH:MM, must be a free slot |
| 7 | `address` | full service address incl. gate/entry/door code |

### Booking Horizon (6-month hard lock)
No booking may be created or offered for a date more than 6 calendar months from today, computed in `BUSINESS.timezone`. Enforced in code:
- `isWithinBookingHorizon(dateStr)` in `booking-service.ts` — deterministic guard
- `createBookingGuarded()` — returns `{ ok:false, reason:"too_far_ahead" }` without writing to DB or Calendar
- `getUpcomingAvailability()` — breaks scan at the horizon, never offers dates past it
- `tooFarAheadEmail` template — warm-professional refusal, asks the customer to reach back out

### Date Format Rule
All customer-facing dates use full-year format: `Month D, YYYY` (e.g. "June 11, 2026"). `prettyDate()` and `prettySlot()` include the year. Standing prompt rule prohibits bare ISO dates and ambiguous numeric formats.

---

## Database Schema

All tables are auto-created on first access. Neon Postgres (serverless driver `@neondatabase/serverless`).

### Core Business Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `clients` | Client golden record | id, email (unique), name, phone, address, city, postal_code, property_type, bedrooms, bathrooms, pets, parking, access_notes, service_interest, recurring, preferred_times, special_instructions, last_contact_at |
| `bookings` | Booking records (source of truth) | id, client_id (FK), service_id, price, date, time, duration, status, calendar_event_id |
| `inquiries` | Inbound email records | id, thread_id, client_id (FK), type, summary, requested_service_id |
| `quotes` | Sent quotes | id, inquiry_id, service_id, price, status, customer_email |
| `email_log` | Email audit trail | id, gmail_message_id, thread_id, direction, classification |

### Operational Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `ai_ops_log` | Operations log | id, type, email_id, thread_id, details, verified |
| `ai_processed_emails` | Dedup / replay protection | message_id (PK), classification, action_taken |
| `ai_usage` | Token/cost tracking per run | id, model, calls, input_tokens, output_tokens, cost_usd |
| `ai_google_auth` | Refresh tokens | email (PK), refresh_token |
| `ai_gmail_watch` | Watch state (historyId + expiry) | email (PK), history_id, expiration |
| `booking_phases` | 3-phase state machine per thread | thread_id (PK), phase, phase1_msg |
| `booking_intent` | 24h session store for in-flight preferences | email (PK), service_id, proposed_date, proposed_time, raw_quote, updated_at |
| `email_triage` | Classification audit log | message_id (PK), intent, confidence, risk |
| `app_settings` | Key-value config (automation on/off) | key (PK), value |
| `waitlist` | Waitlist entries for full dates | id, client_email, service_id, date |

### Security Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `rate_events` | Per-sender + global rate tracking | id, ts, sender, event_type |
| `rate_limits` | Token-bucket state | key (PK), tokens, last_refill |
| `security_events` | Security event audit log | id, ts, event_type, severity, source, ip, sender |

### Campaign Tables (isolated — no FK to core tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `campaign_recipients` | Audience list (demo data by default) | id, email (unique), first_name, vars (JSONB), active, opted_out, status |
| `scheduled_campaigns` | Scheduled email jobs | id, name, template_id, audience, recipient_ids (JSONB), send_at, mode, status |
| `campaign_sends` | Exactly-once send ledger | id, scheduled_campaign_id, recipient_email, send_date, status, provider, error, sent_at; UNIQUE(scheduled_campaign_id, recipient_email, send_date) |

---

## API Endpoints

### Authentication Methods
- **Session**: NextAuth Google OAuth session cookie
- **CRON_SECRET**: Timing-safe comparison via header (`x-cron-secret`) or query param (`?secret=`)
- **GMAIL_WEBHOOK_SECRET**: Shared secret in query param + optional OIDC

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/[...nextauth]` | GET/POST | Public (OAuth flow) | Google sign-in/sign-out |
| `/api/auth/token` | POST/GET | Session | Check refresh token status (reads from DB) |
| `/api/gmail/webhook` | POST | GMAIL_WEBHOOK_SECRET + optional OIDC | Gmail Pub/Sub push notifications |
| `/api/gmail/watch` | GET | CRON_SECRET | Arm/renew Gmail watch subscription |
| `/api/gmail/watch` | POST | Session | Manual watch arming from dashboard |
| `/api/cron/process` | GET | CRON_SECRET | Scheduled email processing |
| `/api/cron/process` | POST | Session | Manual trigger from dashboard |
| `/api/cron/reminders` | GET | CRON_SECRET | Send booking reminders |
| `/api/cron/purge-intent` | GET | CRON_SECRET | Purge expired booking intents (daily 5 AM Vancouver) |
| `/api/automation` | GET/POST | Session or CRON_SECRET | Read/toggle automation on/off |
| `/api/campaigns` | GET | Session or CRON_SECRET | List templates/recipients/scheduled campaigns, preview rendered emails |
| `/api/campaigns` | POST | Session or CRON_SECRET | Schedule/cancel/run campaigns, add/remove recipients. `run-due` is CRON_SECRET-only |
| `/api/campaigns/webhook` | POST | Svix signature | Resend status webhook (bounced, complained, delivered) |
| `/api/chat` | POST | Session | Dashboard chat interface |
| `/api/ops` | GET | Session or CRON_SECRET | Operations dashboard data |

### Ops Views (`/api/ops?view=`)
- `summary` — aggregated ops log (default)
- `operations` — full operations log (last 100)
- `processed` — processed emails log
- `usage` — AI token/cost summary (total, today, recent)
- `security` — security events and counts (last 24h)
- `all` — summary + operations + processed

---

## Library Modules (`src/lib/`)

| Module | Responsibility |
|--------|---------------|
| `automation.ts` | System prompt, 35+ tool definitions (incl. booking intent tools), REQUIRED_BOOKING_FIELDS constant, tool executor, agent loop, cron/webhook entry points |
| `auth.ts` | NextAuth config, Google OAuth scopes, refresh token persistence |
| `google-auth.ts` | Refresh token store (Neon), access token minting, Gmail watch state |
| `gmail.ts` | Gmail API wrapper: read, send, draft, label, search, watch, history |
| `calendar.ts` | Google Calendar API wrapper: list, create, update, delete events |
| `booking-service.ts` | Guarded booking operations: create, reschedule, cancel (enforces catalog prices, slot validation, 24h cancellation policy) |
| `booking-phases.ts` | 3-phase state machine (get/set/reset per thread) |
| `booking-intent.ts` | 24h session store for in-flight booking preferences (get/set/clear/purge) |
| `availability.ts` | Slot computation from bookings DB: `getAvailability`, `isSlotFree`, `getUpcomingAvailability` |
| `clients-db.ts` | Client CRUD, booking CRUD, inquiries, quotes, email log, `getClientProfile()` (consolidated golden record), `mergeUpsertClient()` (merge-only upsert with address history, gate code scrubbing), duplicate detection |
| `catalog.ts` | Service catalog lookup (`getService`, `listServices`, `requireService`) |
| `templates.ts` | 12 email templates with variation engine (`pick()` for warm-professional tone), `validateOutboundFacts` |
| `triage.ts` | `scanRisk()` keyword detector (HUMAN, MONEY_LEGAL, ANGER), classification persistence |
| `ops-log.ts` | Operations log, processed emails, usage/cost tracking |
| `app-settings.ts` | Global automation on/off switch (key-value in Neon) |
| `waitlist.ts` | Waitlist management for full dates |
| `llm.ts` | OpenAI-compatible LLM client (Gemini/DeepSeek fallback) |
| `ai.ts` | Dashboard chat function |
| `rate-guard.ts` | Per-sender cap (10/day), global circuit breaker, daily spend guard |
| `rate-limit.ts` | Token-bucket rate limiter, payload size/shape validation |
| `webhook-verify.ts` | Gmail OIDC verification, Twilio signature verification, timing-safe secret comparison |
| `security-log.ts` | Security events table and logging |
| `campaigns/sender.ts` | Email sender adapter: `GmailSender` (self-contained OAuth), `ResendSender` (full impl, inert w/o key), `getSender()` factory |
| `campaigns/templates.ts` | Campaign template registry with `{{token}}` merge (3 starters: daily_reminder, service_due, followup) |
| `campaigns/audience.ts` | Recipient CRUD (`campaign_recipients` table), demo seeding, audience provider seam |
| `campaigns/config.ts` | Campaign definitions (id, templateId, schedule, audience) |
| `campaigns/engine.ts` | Campaign runner: preview/test/live modes, send ledger (`campaign_sends`), exactly-once dedup |

---

## Campaign Engine (`src/lib/campaigns/`)

Standalone, isolated recurring-email system. Does NOT import from automation.ts, booking-service.ts, the agent loop, or the Gmail webhook. All new code, new tables, new route.

### Isolation
- Self-contained Gmail sender reads OAuth creds from env/DB directly
- No FK to existing tables — `campaign_recipients` is independent
- Separate route (`/api/campaigns`) not added to vercel.json crons
- Resend adapter built but inert unless `RESEND_API_KEY` is set

### Modes
| Mode | Behavior |
|------|----------|
| `preview` (default) | Renders merged emails, returns them. Sends nothing, writes nothing. |
| `test` | Sends all rendered emails to `CAMPAIGN_TEST_ADDRESS` only. Ignores real recipient list. |
| `live` | Sends to real recipients. Gated by `CAMPAIGNS_ENABLED=true`. Idempotent via send ledger (unique on campaign+email+date). |

### Route (`/api/campaigns`)
| Method | Action | Purpose |
|--------|--------|---------|
| GET | `?action=list` | List campaigns and templates |
| GET | `?action=preview&campaign=<id>` | Render merged demo emails (sends nothing) |
| GET | `?action=recipients` | List all recipients |
| POST | `?action=add_recipient` | Add/reactivate a recipient |
| POST | `?action=remove_recipient` | Deactivate a recipient |
| POST | `?action=run&campaign=<id>&mode=test\|live` | Execute a campaign run |

### Template Merge
Mechanical `{{token}}` replacement — no LLM. Unknown tokens replaced with empty string. Tokens: `first_name`, `date`, `time`, `service`, `address`, plus any key in the recipient's `vars` JSONB.

---

## Security Architecture

### Prompt Injection Containment
- Email bodies wrapped in `<untrusted-email>` delimiters
- Anti-injection warning in system prompt
- Injected `</untrusted-email>` tags stripped from email content
- Owner email removed from prompt (model uses `notify_owner` tool)

### Client Profile Security
- Golden record fields are `<trusted-internal-data>` — never mixed with `<untrusted-email>` content
- Gate/lock codes are automatically scrubbed from `access_notes` (stored as "has gate/door code — see thread")
- Duplicate customers (same name+phone, different email) flagged to owner — never auto-merged
- `mergeUpsertClient()` never blanks an existing value; address changes are tracked in notes with timestamps

### Recipient Allowlist
- Outbound emails restricted to original sender(s) of the inbound email
- Enforced on `compose_and_send`, `send_email`, `draft_email`
- Owner/employee addresses always allowed (for internal routing)

### Destructive Action Gate
- One `create_booking` / `cancel_booking` / `reschedule_booking` per inbound
- Tracked via `ctx.destructiveActionDone`

### Rate & Spend Guards
- **Per-sender**: 10 replies/day (configurable via `MAX_REPLIES_PER_SENDER_DAY`)
- **Global circuit breaker**: 100 inbound events/hour (`MAX_INBOUND_PER_HOUR`)
- **Daily spend cap**: $25/day API cost (`MAX_DAILY_SPEND_USD`)
- Owner notified by email on critical guard trips

### Webhook Authentication
- Shared secret (timing-safe comparison) on all CRON_SECRET routes
- Gmail webhook: shared secret + optional OIDC token verification
- Twilio signature verifier ready for future SMS webhook

### Security Headers
HSTS, CSP, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy — all set via `next.config.ts`.

### Observability
- `security_events` table logs: auth failures, rate limits, circuit breaker trips, spend caps, recipient blocks, destructive gate blocks, payload rejections, OIDC failures
- `/api/ops?view=security` for dashboard access
- AI token/cost tracking per run in `ai_usage`
- Operations log with verified flag in `ai_ops_log`

---

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon Postgres connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `NEXTAUTH_SECRET` | NextAuth session encryption key |
| `NEXTAUTH_URL` | Base URL for OAuth redirects (e.g. `https://ai-ops-tool.vercel.app`) |
| `CRON_SECRET` | Shared secret for cron/admin endpoints |
| `GMAIL_WEBHOOK_SECRET` | Shared secret for Gmail Pub/Sub webhook URL |
| `OPS_GMAIL_ADDRESS` | Gmail address the automation operates on |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_PROVIDER` | (auto) | Set to `"anthropic"` to use native Anthropic SDK with prompt caching. **Currently set to `anthropic`.** |
| `AI_MODEL` | `gemini-2.5-flash-lite` | Model ID (overridden when AI_PROVIDER=anthropic) |
| `AI_BASE_URL` | Google Generative Language | Base URL for OpenAI-compatible LLM fallback |
| `AI_API_KEY` / `GEMINI_API_KEY` | — | API key for OpenAI-compatible fallback |
| `GMAIL_PUBSUB_TOPIC` | `projects/ai-ops-tool/topics/gmail-push` | Google Pub/Sub topic |
| `GMAIL_PUBSUB_AUDIENCE` | — | Webhook URL for Pub/Sub OIDC token verification. **Currently active — OIDC verification enabled.** |
| `GOOGLE_ACCESS_TOKEN` | — | Legacy fallback (deprecated — use refresh token flow) |
| `MAX_REPLIES_PER_SENDER_DAY` | `10` | Per-sender email reply cap (1-day window) |
| `MAX_INBOUND_PER_HOUR` | `100` | Global inbound circuit breaker |
| `MAX_DAILY_SPEND_USD` | `25` | Daily AI API cost cap |
| `CAMPAIGNS_ENABLED` | `false` | Must be `true` for live campaign sends |
| `CAMPAIGN_EMAIL_PROVIDER` | `gmail` | Campaign sender: `gmail` or `resend` |
| `CAMPAIGN_TEST_ADDRESS` | — | Recipient for campaign test-mode sends |
| `RESEND_API_KEY` | — | Resend adapter (inert unless set) |

---

## Templates & Outbound Email

All customer-facing emails are sent via `compose_and_send`, which picks a template and fills it from source-of-truth data. The model does not write email bodies.

| Template | When Used |
|----------|-----------|
| `services_list` | Customer hasn't specified a service — shows 1-3 relevant services (via `serviceIds`) with short blurbs, not the full catalog |
| `quote` | Specific service identified, sends price |
| `availability` | Customer asks for available times |
| `booking_confirmation` | Booking created successfully |
| `missing_info` | Consolidated checklist of all 7 required booking fields (pre-filled + blanks) |
| `reschedule` | Booking rescheduled |
| `cancellation` | Booking cancelled |
| `cancellation_fee_notice` | Cancellation within 24h notice window |
| `waitlist_opening` | Waitlisted date has an opening |
| `too_far_ahead` | Date beyond 6-month booking horizon |
| `reminder` | Booking reminder (cron-triggered) |

Each template uses a `pick()` function for variation (warm-professional tone). `validateOutboundFacts()` blocks any email whose dollar amounts don't match catalog prices.

---

## Services Catalog

Each service has a `short` blurb (≤8 words) used in service-list replies, plus a full `description` used elsewhere.

| ID | Name | Duration | Price (CAD) |
|----|------|----------|-------------|
| `regular` | Regular Clean | 150 min | $200 |
| `deep` | Deep Clean | 270 min | $380 |
| `turnover` | Vacation Rental Turnover | 150 min | $220 |
| `moveout` | Move-In / Move-Out Clean | 300 min | $450 |
| `post-construction` | Post-Construction Clean | 360 min | $550 |
| `pressure-washing` | Pressure Washing | 180 min | $320 |
| `carpet` | Carpet Cleaning | 120 min | $220 |
| `laundry` | Laundry Service | 90 min | $85 |
| `commercial` | Commercial / Office Clean | 180 min | $280 |

Working hours: 08:00–17:00 Mon–Fri, 09:00–15:00 Sat & Sun. 30-minute buffer between appointments. Timezone: America/Vancouver.

---

## Key Design Decisions

1. **Database is source of truth for availability** — Calendar is a write-through mirror. The model queries `bookings` via `getAvailability`/`isSlotFree`, not the Calendar API.

2. **Ask-first booking flow** — Phase 1 sends price only (no times). Availability is shown only when the customer asks. Prevents over-offering and keeps conversations natural.

3. **Template-only outbound** — The model cannot write customer email bodies. It passes structured data to `compose_and_send`, which uses code-assembled templates. This prevents hallucinated prices, times, or commitments.

4. **Code-level guards over prompt instructions** — Every critical constraint (price validation, phase gates, recipient allowlists, one-reply rule, destructive action limits) is enforced in `executeTool`, not just in the system prompt. The prompt instructs; the code enforces.

5. **Exactly-once processing** — `claimEmail()` uses `INSERT ... ON CONFLICT DO NOTHING RETURNING` for atomic dedup. Webhook retries and Pub/Sub redelivery are safe.

6. **Single-tenant** — One business, one Gmail account, one owner. The `authorized()` check is "are you the owner?" (via session or CRON_SECRET), not multi-tenant RBAC.

7. **6-month booking horizon** — Hard lock in code, not a prompt instruction. `isWithinBookingHorizon()` computed in business timezone. Both `createBookingGuarded` and `getUpcomingAvailability` enforce it. The model cannot bypass it.

8. **One-shot booking checklist** — Phase 2 sends all 7 required fields in a single email (name, phone, service, address+code, date, time) with known fields pre-filled. Never drips fields across multiple emails. The `REQUIRED_BOOKING_FIELDS` constant is the single source of truth for what fields are required — both the tool response and the create_booking guard derive from it.

9. **Campaign isolation** — The recurring-email engine lives entirely under `src/lib/campaigns/` with its own tables, route, and sender. Zero imports from the agent/automation/booking code. Can be removed without affecting the live system.

---

## File Structure

```
ai-ops-tool/
  src/
    app/
      api/
        auth/
          [...nextauth]/route.ts   NextAuth handler
          token/route.ts           Token status check
        automation/route.ts        Start/stop toggle
        campaigns/
          route.ts                 Campaign engine API (isolated)
          webhook/route.ts         Resend status webhook
        chat/route.ts              Dashboard chat
        cron/
          process/route.ts         Scheduled email processing
          reminders/route.ts       Booking reminders
          purge-intent/route.ts    Daily booking intent cleanup
        gmail/
          watch/route.ts           Arm/renew Gmail watch
          webhook/route.ts         Gmail Pub/Sub push handler
        ops/route.ts               Operations dashboard
      components/
        ScheduledEmailsPanel.tsx   Campaign dashboard panel
      page.tsx                     Dashboard UI
      layout.tsx                   Root layout
    config/
      business.ts                  Business config (services, pricing, people)
      RULES.md                     Business rules (loaded at runtime)
    lib/
      automation.ts                Core automation engine (~2000 lines)
      auth.ts                      NextAuth config
      google-auth.ts               Refresh token + watch state (Neon)
      gmail.ts                     Gmail API wrapper
      calendar.ts                  Calendar API wrapper
      booking-service.ts           Guarded booking ops + 6-month horizon
      booking-phases.ts            Phase state machine
      booking-intent.ts            24h intent session store
      availability.ts              Slot computation (horizon-aware)
      clients-db.ts                Client/booking/inquiry CRUD
      catalog.ts                   Service catalog
      templates.ts                 Email templates + fact validation
      triage.ts                    Risk scan + classification log
      ops-log.ts                   Operations log + usage tracking
      app-settings.ts              Automation on/off switch
      waitlist.ts                  Waitlist management
      llm.ts                       OpenAI-compatible LLM client
      ai.ts                        Dashboard chat
      rate-guard.ts                Volume abuse guards (10/sender/day)
      rate-limit.ts                Token-bucket rate limiter
      webhook-verify.ts            Webhook auth utilities
      security-log.ts              Security event logging
      campaigns/
        sender.ts                  Gmail + Resend email adapters
        templates.ts               Campaign template registry
        audience.ts                Recipient CRUD + demo seeding
        config.ts                  Campaign definitions
        engine.ts                  Render/send/dedup engine
  next.config.ts                   Security headers
  verify.mjs                       Test suite (9 tests)
  SECURITY_AUDIT.md                Security gap analysis
  ROTATE_CREDENTIALS.md            Credential rotation guide
  DATA_PROTECTION.md               PIPEDA/CASL compliance
  ARCHITECTURE.md                  This file
```
