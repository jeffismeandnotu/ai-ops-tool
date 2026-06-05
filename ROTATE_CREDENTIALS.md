# Credential Rotation Checklist

## Immediate Actions Required

### 1. CRON_SECRET (HIGH)
- **Why**: Was previously hardcoded in `verify.mjs` (now reads from env). The old value exists in git history.
- **Action**: Generate a new secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Update in**: Vercel dashboard > Environment Variables > `CRON_SECRET`
- **Verify**: Run `CRON_SECRET=<new> node verify.mjs` — all 9 tests should pass.

### 2. OPS_GMAIL_ADDRESS (NEW — required)
- **Why**: Previously hardcoded in `src/lib/google-auth.ts`. Now throws if not set.
- **Action**: Set `OPS_GMAIL_ADDRESS` in Vercel dashboard to the Gmail address the automation operates on.

### 3. NEXTAUTH_URL (MEDIUM)
- **Why**: Was hardcoded in `next.config.ts` and `src/lib/auth.ts`. Now sourced from env only.
- **Action**: Ensure `NEXTAUTH_URL` is set in Vercel dashboard (e.g., `https://ai-ops-tool.vercel.app`).
- **Note**: NextAuth derives the callback URL from this.

## New Environment Variables (Sections 2-4)

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_REPLIES_PER_SENDER_HOUR` | 5 | Per-sender email reply cap |
| `MAX_INBOUND_PER_HOUR` | 100 | Global circuit breaker (all senders) |
| `MAX_DAILY_SPEND_USD` | 25 | Daily AI API cost cap |
| `GMAIL_PUBSUB_AUDIENCE` | (not set) | Set to webhook URL to enable OIDC verification |

## Periodic Rotation Schedule

| Secret | Rotation | Method |
|--------|----------|--------|
| `CRON_SECRET` | Every 90 days | Generate new hex, update Vercel + any external cron callers |
| `GMAIL_WEBHOOK_SECRET` | Every 90 days | Generate new, update Vercel + Pub/Sub subscription URL |
| `NEXTAUTH_SECRET` | Every 90 days | Generate new, existing sessions will be invalidated |
| `GOOGLE_CLIENT_SECRET` | On compromise | Rotate in Google Cloud Console, update Vercel |
| `ANTHROPIC_API_KEY` | On compromise | Rotate in Anthropic Console, update Vercel |
| `DATABASE_URL` | On compromise | Rotate in Neon Console, update Vercel |

## Google OAuth Scope Review

Current scopes granted:
- `gmail.readonly` — needed for reading inbound emails
- `gmail.compose` — needed for sending replies
- `gmail.modify` — needed for labeling processed emails
- `gmail.labels` — needed for managing labels
- `calendar` — needed for booking management
- `calendar.events` — needed for creating/updating events

**Recommendation**: `gmail.modify` is broader than needed (includes delete). Consider narrowing to `gmail.labels` + `gmail.compose` + `gmail.readonly` if label management and compose cover all use cases. Test before removing.

## Git History Cleanup

The following values exist in git history and should be considered compromised:
- CRON_SECRET value from `verify.mjs` (commit history before this audit)
- Personal email address from `google-auth.ts`
- Vercel deployment URLs from `next.config.ts` and `auth.ts`

If this is a private repo, the risk is lower but rotation is still recommended.
