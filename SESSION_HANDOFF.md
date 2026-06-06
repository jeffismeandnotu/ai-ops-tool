# Session Handoff — ai-ops-tool

Last updated: 2026-06-05

---

## What Changed This Session

### 1. Rate Limit — 10/sender/day (commits `94675a5`, `b7a8bce`)

The per-sender rate limit was widened from 5 replies per hour to **10 replies per day**.

- **File**: `src/lib/rate-guard.ts`
- `DEFAULT_SENDER_CAP` → 10
- SQL interval → `'1 day'`
- **Env var renamed**: `MAX_REPLIES_PER_SENDER_HOUR` → `MAX_REPLIES_PER_SENDER_DAY` (default 10)
- Global cap (`MAX_INBOUND_PER_HOUR`) unchanged
- **Action needed**: If the old env var was set in Vercel, rename it to `MAX_REPLIES_PER_SENDER_DAY`. If unset, the new default 10 applies.

### 2. Phase-2 Consolidated Checklist (commits `92fea60`, `b7a8bce`)

After a customer confirms a service (e.g. "yes, regular clean"), the agent now sends **one email** with all 5 required booking fields, not individual drip requests.

- **Files**: `src/lib/templates.ts`, `src/lib/automation.ts`
- `missingInfoEmail` reworked: accepts `serviceName`, `knownFields` (name, address, date, time)
- Known fields shown pre-filled with "reply to confirm or correct"
- Unknown fields shown as "(please provide)"
- The `compose_and_send` tool schema has new inputs: `serviceName`, `knownName`, `knownAddress`, `knownDate`, `knownTime`
- Prompt phase-2 instructions updated to require the consolidated checklist

### 3. Full-Year Date Format (commit `92fea60`)

All customer-facing dates now include the year.

- **Files**: `src/lib/templates.ts`, `src/config/RULES.md`, `src/lib/automation.ts`
- `prettyDate("2026-06-11")` → `"Wednesday, June 11, 2026"` (was `"Wednesday, June 11"`)
- `prettySlot("2026-06-11 08:00")` → `"Wednesday, June 11, 2026 at 8:00 AM"`
- Standing prompt rule: always write dates as `Month D, YYYY`

### 4. 6-Month Booking Horizon (commits `92fea60`, `580630d`, `b7a8bce`)

Hard code-level lock — no booking created or offered beyond 6 calendar months from today.

- **Files**: `src/lib/booking-service.ts`, `src/lib/availability.ts`, `src/lib/templates.ts`, `src/lib/automation.ts`, `src/config/RULES.md`
- `isWithinBookingHorizon(dateStr)` in `booking-service.ts` — exported helper
- `createBookingGuarded()` returns `{ ok:false, reason:"too_far_ahead" }` — no DB/calendar write
- `getUpcomingAvailability()` breaks scan at horizon — never offers dates past it
- New `tooFarAheadEmail` template — warm refusal
- New `too_far_ahead` template in `compose_and_send` enum
- Prompt rule added to RULES.md and automation prompt

### 5. Campaign Engine (commits `57a6113`, `d0f2e95`, `48dca55`, `fd0b0a9`)

Standalone recurring-email system, fully isolated from the agent/automation code.

- **Directory**: `src/lib/campaigns/` (5 files) + `src/app/api/campaigns/route.ts`
- **Zero imports** from automation.ts, booking-service.ts, gmail.ts, ai.ts, or booking-phases.ts
- **Zero modifications** to any existing file

#### New Files
| File | Purpose |
|------|---------|
| `campaigns/sender.ts` | `GmailSender` (self-contained OAuth) + `ResendSender` (inert w/o key) + `getSender()` factory |
| `campaigns/templates.ts` | 3 starter templates (daily_reminder, service_due, followup) with `{{token}}` merge |
| `campaigns/audience.ts` | `campaign_recipients` table, demo seeding, list/add/remove |
| `campaigns/config.ts` | 3 campaign definitions (editable config object) |
| `campaigns/engine.ts` | `runCampaign(id, mode)` — preview/test/live, send ledger |

#### New Tables
| Table | Key Constraint |
|-------|---------------|
| `campaign_recipients` | email UNIQUE, no FK to existing tables |
| `campaign_sends` | UNIQUE(campaign_id, recipient_email, send_date) — exactly-once |

#### New Env Vars
| Variable | Default | Notes |
|----------|---------|-------|
| `CAMPAIGNS_ENABLED` | `false` | Must be `true` for live sends |
| `CAMPAIGN_EMAIL_PROVIDER` | `gmail` | `gmail` or `resend` |
| `CAMPAIGN_TEST_ADDRESS` | (unset) | **Set to `biggguy0047@gmail.com` on Vercel** |
| `RESEND_API_KEY` | (unset) | Resend adapter inert unless set |

#### Route: `/api/campaigns`
Gated by `CRON_SECRET` (same pattern as cron routes). NOT added to vercel.json crons.

| Action | Method | What it does |
|--------|--------|-------------|
| `list` | GET | List campaigns + templates |
| `preview&campaign=<id>` | GET | Render merged demo emails, send nothing |
| `recipients` | GET | List all recipients |
| `add_recipient` | POST | Add/reactivate (body: `{email, firstName, vars}`) |
| `remove_recipient` | POST | Soft-deactivate (body: `{email}`) |
| `run&campaign=<id>&mode=test` | POST | Send to test address only |
| `run&campaign=<id>&mode=live` | POST | Real send (refused unless CAMPAIGNS_ENABLED=true) |

#### Verified
- Preview renders 3 demo emails, sends nothing
- Test mode sends to `biggguy0047@gmail.com` only (3 emails received with `[TEST]` prefix)
- Live mode refused with clear error when CAMPAIGNS_ENABLED is not `true`
- Recipients list/add/remove all work
- Existing agent, webhook, booking, main switch completely untouched

---

## Current System State

- **Deployed**: Vercel production (`ai-ops-tool.vercel.app`)
- **Branch**: `main` (all commits pushed)
- **Automation**: Controlled by the existing Start/Stop switch (unchanged)
- **Campaigns**: Default safe mode — preview only, no live sends unless CAMPAIGNS_ENABLED=true
- **Rate limit**: 10 replies/sender/day
- **Booking horizon**: 6 months from today
- **Date format**: Full year in all customer-facing dates
- **Phase 2**: One-shot consolidated checklist

---

## Open Items / Next Steps

1. **Campaign cron scheduling** — Campaign configs have a `schedule` string (informational). Not wired to vercel.json crons yet. When ready, add a cron entry that calls `/api/campaigns?action=run&campaign=<id>&mode=live`.

2. **Audience provider swap** — `campaigns/audience.ts` has a clearly-marked seam. To switch from demo data to real clients, implement a provider that queries the `clients` table and returns the same `Recipient` shape.

3. **Resend activation** — Full `ResendSender` implementation is built. Set `RESEND_API_KEY` and `CAMPAIGN_EMAIL_PROVIDER=resend` to switch. Consider also setting `RESEND_FROM_ADDRESS`.

4. **Campaign recipient vars** — Demo recipients have basic vars (`service`, `address`). Real recipients would need richer merge data (last booking date, next due date, etc.) — extend the `vars` JSONB or pull from the clients/bookings tables via the audience provider.

5. **Old env var cleanup** — If `MAX_REPLIES_PER_SENDER_HOUR` is still set in Vercel env, remove it and set `MAX_REPLIES_PER_SENDER_DAY` instead.

---

## Key Files to Read First

| File | Why |
|------|-----|
| `ARCHITECTURE.md` | Full system architecture (updated this session) |
| `src/lib/automation.ts` | Core agent — 3-phase booking, tools, prompt |
| `src/lib/campaigns/engine.ts` | Campaign runner — modes, ledger, dedup |
| `src/config/RULES.md` | Business rules — date format, booking horizon, tone |
| `src/lib/booking-service.ts` | Booking guards — horizon, slot validation, DB+Calendar |
| `src/lib/templates.ts` | All email templates — missingInfoEmail, tooFarAheadEmail |
