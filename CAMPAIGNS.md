# Campaign System — Go-Live Seams

This document lists every connection point between the campaign engine and the live system. The campaign system is fully isolated today; these seams are the steps to activate it.

---

## 1. Audience Source

**Current**: Demo recipients in `campaign_recipients` table (demo1@example.com, demo2@example.com, demo3@example.com).

**Go-live**: Populate `campaign_recipients` with real client data. Options:
- Manual: Add via the dashboard Recipients panel or the API (`POST /api/campaigns?action=add-recipient`)
- Automated: Write a sync script that copies from the `clients` table into `campaign_recipients` (same shape: email, first_name, vars JSONB). No FK — just a periodic ETL.

---

## 2. Email Provider & Env Vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `CAMPAIGNS_ENABLED` | `false` | Must be `true` for live sends to real recipients |
| `CAMPAIGN_EMAIL_PROVIDER` | `gmail` | `gmail` or `resend` |
| `CAMPAIGN_TEST_ADDRESS` | (unset) | Required for test mode — all test sends go here |
| `RESEND_API_KEY` | (unset) | Resend adapter is inert unless set |
| `RESEND_FROM_ADDRESS` | falls back to `OPS_GMAIL_ADDRESS` | From address for Resend sends |
| `RESEND_WEBHOOK_SECRET` | (unset) | Svix signing secret for Resend status webhooks |

**Go-live**: Set `CAMPAIGNS_ENABLED=true` on Vercel. If switching to Resend, set `CAMPAIGN_EMAIL_PROVIDER=resend` and `RESEND_API_KEY`.

---

## 3. Enable Flag

The engine refuses all live sends unless `CAMPAIGNS_ENABLED=true`. This is checked at runtime in `runScheduled()` — there is no compile-time gate.

**Go-live**: `vercel env add CAMPAIGNS_ENABLED production` → `true`

---

## 4. Cron Registration (run-due)

The `run-due` endpoint is built but **not registered** in `vercel.json` crons. It requires `CRON_SECRET` auth.

**Go-live**: Add to `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/campaigns?action=run-due&secret=<CRON_SECRET>",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

Or call it manually: `POST /api/campaigns?action=run-due` with header `x-cron-secret: <value>`.

---

## 5. Resend Webhook URL & Secret

The webhook endpoint is at `/api/campaigns/webhook`. It handles Resend status events (bounced, complained, delivered, sent).

**Go-live**:
1. In Resend dashboard → Webhooks → Add endpoint: `https://ai-ops-tool.vercel.app/api/campaigns/webhook`
2. Select events: `email.bounced`, `email.complained`, `email.delivered`, `email.sent`
3. Copy the signing secret → set `RESEND_WEBHOOK_SECRET` on Vercel
4. The webhook is a no-op if `RESEND_WEBHOOK_SECRET` is unset

---

## 6. New Tables

All auto-created via `CREATE TABLE IF NOT EXISTS` on first use:

| Table | Key Constraint | Purpose |
|-------|---------------|---------|
| `campaign_recipients` | `email UNIQUE` | Audience list (demo data) |
| `scheduled_campaigns` | none | Scheduled email jobs |
| `campaign_sends` | `UNIQUE (scheduled_campaign_id, recipient_email, send_date)` | Exactly-once send ledger |

No foreign keys to any existing table.

---

## 7. Dashboard Panel

Located in the Automation tab → "Scheduled Emails" section. Self-contained React component (`src/app/components/ScheduledEmailsPanel.tsx`). Uses session auth via the existing NextAuth cookie — no separate login needed.

---

## 8. API Routes

All under `/api/campaigns`:

| Action | Method | Auth | Purpose |
|--------|--------|------|---------|
| `templates` | GET | Session or CRON_SECRET | List templates |
| `recipients` | GET | Session or CRON_SECRET | List recipients |
| `add-recipient` | POST | Session or CRON_SECRET | Add/reactivate |
| `remove-recipient` | POST | Session or CRON_SECRET | Soft-deactivate |
| `scheduled` | GET | Session or CRON_SECRET | List scheduled campaigns |
| `schedule` | POST | Session or CRON_SECRET | Create scheduled campaign |
| `cancel` | POST | Session or CRON_SECRET | Cancel scheduled campaign |
| `preview` | GET | Session or CRON_SECRET | Render template with recipient data |
| `run` | POST | Session or CRON_SECRET | Run a campaign now |
| `run-due` | POST | **CRON_SECRET only** | Scheduler — run all due campaigns |

Webhook: `POST /api/campaigns/webhook` — Svix signature auth (no session/CRON_SECRET).
