# Security Audit — ai-ops-tool

**Audited**: 2026-06-05
**Stack**: Next.js 16, Vercel, Neon Postgres, Gmail Pub/Sub, Google Calendar, Anthropic Claude agent
**Repo**: jeffismeandnotu/ai-ops-tool

---

## Endpoint Map & Authentication

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/[...nextauth]` | GET/POST | Public (OAuth flow) | NextAuth Google sign-in |
| `/api/auth/token` | POST/GET | Session | Save/check refresh token to local file |
| `/api/automation` | GET/POST | Session OR CRON_SECRET | Start/stop automation switch |
| `/api/chat` | POST | Session | Dashboard chat interface |
| `/api/cron/process` | GET/POST | CRON_SECRET (header or query) | Scheduled email processing |
| `/api/cron/reminders` | GET | CRON_SECRET (header or query) | Send booking reminders |
| `/api/gmail/watch` | GET/POST | CRON_SECRET (GET) / Session (POST) | Arm/renew Gmail push watch |
| `/api/gmail/webhook` | POST | GMAIL_WEBHOOK_SECRET (query param) | Gmail Pub/Sub push handler |
| `/api/ops` | GET | Session OR CRON_SECRET | Operations log dashboard |

**Planned but not yet built**: Public booking API, embeddable widget, Twilio SMS webhook.

---

## Current State — What's Working

1. **Dedup / replay protection**: `claimEmail()` atomic claim prevents double-processing (webhook retries, Pub/Sub redelivery).
2. **One-reply rule**: `ctx.repliedTo` Set blocks a second customer email per inbound for both `compose_and_send` and `send_email`.
3. **Business-address block**: Regex blocks sending to any `glowcleaning` address.
4. **Template-only outbound**: Customer emails use `compose_and_send` (code-assembled templates); `send_email` is for internal/owner notes. Both validate prices via `validateOutboundFacts`.
5. **Phase gate**: `create_booking` requires thread phase >= 2 (client confirmed). Can't skip phases.
6. **Risk scan**: `scanRisk()` keyword detector flags money/legal/anger/human-request terms; forces escalation.
7. **Classification routing**: `classify_email` returns routing guidance; high-risk or low-confidence forces escalation.
8. **Slot validation**: Slots are validated against the bookings DB before being offered or booked.
9. **Start/Stop switch**: Global automation kill switch via `app_settings`.
10. **Webhook auth**: Gmail webhook requires `GMAIL_WEBHOOK_SECRET` in query params.
11. **Cron auth**: All cron routes require `CRON_SECRET`.
12. **Session auth**: Dashboard routes require NextAuth session.

---

## Gaps Identified

### CRITICAL — Prompt Injection / Agent Containment

- **GAP-1**: Email body is interpolated directly into the user message with no untrusted-data delimiters. An attacker can craft an email body that looks like system instructions.
- **GAP-2**: No recipient allowlist enforced in code. The `send_email` tool blocks `glowcleaning` addresses but allows any other address the model outputs. An attacker could instruct the model to email `attacker@evil.com`.
- **GAP-3**: No destructive-action gate. Bulk cancellations, fee waivers, or money-touching actions could be auto-executed if the model is tricked.
- **GAP-4**: No guard against the model emitting secrets. Environment variables aren't in the prompt, but the model could be tricked into calling tools that leak internal state.
- **GAP-5**: `draft_email` tool has no recipient validation.

### HIGH — Denial-of-Wallet / Volume Abuse

- **GAP-6**: No per-sender rate limit. An attacker could send 1000 emails and trigger 1000 Anthropic API calls.
- **GAP-7**: No global circuit breaker. A flood of inbound emails will process them all, racking up API costs.
- **GAP-8**: No daily spend cap. The `ai_usage` table records costs but nothing stops processing when a threshold is hit.

### HIGH — Webhook Security

- **GAP-9**: Gmail webhook uses a shared secret in the URL query string only. No Pub/Sub OIDC token verification. The secret is in the URL (logged by proxies/CDNs).
- **GAP-10**: No Twilio signature verification ready for the planned SMS webhook.

### MEDIUM — Rate Limiting / Input Validation

- **GAP-11**: No rate limiting on any endpoint. The Gmail webhook, chat, and automation endpoints accept unlimited requests.
- **GAP-12**: No payload size cap. A malicious Pub/Sub message or chat request could be arbitrarily large.
- **GAP-13**: Email body is truncated to 1000 chars in the prompt but not validated for encoding attacks.

### MEDIUM — Secrets Hygiene

- **GAP-14**: `verify.mjs` contains a hardcoded CRON_SECRET value (`07356b...`). This file is in the git history.
- **GAP-15**: `/api/auth/token` writes access tokens to a local file (`data/token.json`). On Vercel (ephemeral FS) this is harmless but the pattern is insecure.
- **GAP-16**: `next.config.ts` hardcodes `NEXTAUTH_URL`. Not a secret, but the pattern of hardcoding config is fragile.

### MEDIUM — Authorization / Data Protection

- **GAP-17**: `/api/ops` returns all operations, bookings, and processed emails to any authenticated session. No per-user scoping.
- **GAP-18**: Client database has no field allowlist on update paths. The `update_client` tool allows setting any field.
- **GAP-19**: No data retention policy documented. PII (names, addresses, phones, emails) is stored indefinitely.

### LOW — Infrastructure

- **GAP-20**: No security headers (HSTS, CSP, X-Content-Type-Options, etc.) in `next.config.ts`.
- **GAP-21**: No npm audit record. Dependencies may have known vulnerabilities.
- **GAP-22**: Google OAuth scopes are broad (`gmail.modify`, `gmail.compose`, `calendar`, `calendar.events`). Some may exceed least-privilege.

---

## Environment Variables Required

| Variable | Purpose | Current |
|----------|---------|---------|
| `DATABASE_URL` | Neon Postgres connection | Set |
| `ANTHROPIC_API_KEY` | Claude API key | Set |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Set |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Set |
| `NEXTAUTH_SECRET` | NextAuth session encryption | Set |
| `NEXTAUTH_URL` | OAuth redirect base URL | Set (also hardcoded) |
| `CRON_SECRET` | Authenticates cron/admin endpoints | Set |
| `GMAIL_WEBHOOK_SECRET` | Authenticates Gmail Pub/Sub webhook | Set |
| `GMAIL_PUBSUB_TOPIC` | Pub/Sub topic name | Optional (has default) |
| `GOOGLE_ACCESS_TOKEN` | Legacy fallback for cron/process | Deprecated |
| `AI_PROVIDER` | LLM provider switch ("anthropic" or default) | Optional |
| `MAX_REPLIES_PER_SENDER_HOUR` | Per-sender reply cap | **NEW — to add** |
| `MAX_INBOUND_PER_HOUR` | Global inbound circuit breaker | **NEW — to add** |
| `MAX_DAILY_SPEND_USD` | Daily API spend cap | **NEW — to add** |

---

## Remediation Plan

Sections 1-8 of this audit will address each gap group in priority order. See commit history for implementation.
