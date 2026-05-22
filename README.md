# CleanBook AI — Operations Assistant

AI-powered email and calendar management for service businesses. Uses Claude AI to read emails, manage schedules, send confirmations, and coordinate between owner, employees, and clients.

## Architecture

```
Client (Browser)
  ↓ Chat message
Next.js API (/api/chat)
  ↓ Authenticated via NextAuth + Google OAuth
Claude AI (Anthropic API)
  ↓ Tool calls
Gmail API ← read/draft/send emails
Calendar API ← create/update/cancel events
  ↓ Results
Claude AI → natural language response
  ↓
Client (Browser)
```

## What It Does

- **Reads emails** from clients, employees, and partners
- **Drafts and sends emails** — booking confirmations, reminders, follow-ups, schedule changes
- **Manages Google Calendar** — checks availability, creates bookings, reschedules, cancels
- **Coordinates people** — notifies employees of assignments, keeps manager informed
- **Understands context** — knows your services, prices, employees, and working hours

## Setup

### 1. Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`
5. Copy Client ID and Client Secret

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in:
- `GOOGLE_CLIENT_ID` — from step 1
- `GOOGLE_CLIENT_SECRET` — from step 1
- `NEXTAUTH_SECRET` — run `openssl rand -base64 32`
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com/)

### 3. Business Configuration

Edit `src/config/business.ts`:
- Company name, timezone
- Owner/manager email and phone
- Employee list with names, emails, availability
- Services with names, durations, prices
- Email templates
- Working hours and calendar settings
- AI system prompt

### 4. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign in with the business Google account.

### 5. Deploy (Vercel)

```bash
vercel
```

Add environment variables in Vercel dashboard. Update `NEXTAUTH_URL` to production URL.

## Customization

**Everything is in `src/config/business.ts`.** No other file needs to change to customize for a different client.

| What to change | Where |
|---|---|
| Business name | `BUSINESS.name` |
| Services & prices | `BUSINESS.services` |
| Employees | `BUSINESS.employees` |
| Working hours | `BUSINESS.calendar.workingHours` |
| Email templates | `BUSINESS.emailTemplates` |
| AI behavior | `BUSINESS.ai.systemPrompt` |
| Buffer between jobs | `BUSINESS.calendar.bufferMinutes` |
| Timezone | `BUSINESS.timezone` |

## Available AI Commands (examples)

- "Check today's schedule"
- "What emails came in today?"
- "Book a deep clean for Sarah Mitchell on Friday at 10am at 123 Main St"
- "Send a reminder for tomorrow's appointments"
- "Find available slots next Tuesday for a move-out clean"
- "Reschedule the 2pm booking to Thursday"
- "Cancel the booking for John at 3pm"
- "Draft a follow-up email to the client from yesterday's clean"
- "Email Employee 1 their schedule for this week"
- "What's our availability next week?"

## Tech Stack

- **Next.js 15** — React framework
- **NextAuth v5** — Google OAuth with Gmail + Calendar scopes
- **Anthropic Claude** — AI reasoning with tool use
- **Google APIs** — Gmail and Calendar direct integration
- **Tailwind CSS** — Styling

## Cost

- **Claude API**: ~$5-10/month for a small business (~50-100 conversations/month)
- **Google APIs**: Free (within standard quotas)
- **Hosting**: Free on Vercel hobby tier
- **Total**: ~$5-10/month vs $22-35/month/user for competitors (Lindy, Clara, Sintra)
