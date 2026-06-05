# Data Protection Notice

## Jurisdiction
This application operates in British Columbia, Canada and is subject to:
- **PIPEDA** (Personal Information Protection and Electronic Documents Act)
- **CASL** (Canada's Anti-Spam Legislation)
- **BC PIPA** (Personal Information Protection Act, BC)

## Personal Information Collected
| Data | Source | Purpose | Retention |
|------|--------|---------|-----------|
| Client name | Email / booking | Service delivery, communication | Active + 7 years (tax) |
| Client email | Email | Communication, booking confirmation | Active + 7 years |
| Client phone | Email / form | Service coordination | Active + 7 years |
| Client address | Email / form | Service delivery location | Active + 7 years |
| Booking history | App-generated | Service records, returning-client pricing | Active + 7 years |
| Email content | Gmail API | Classification, response generation | 90 days (ops log) |
| AI conversation logs | App-generated | Audit trail, debugging | 90 days |

## CASL Compliance
- All outbound emails are **transactional** (booking confirmations, service inquiries, reminders) — not commercial electronic messages.
- No marketing emails are sent by the automation.
- If marketing is added in the future, explicit opt-in consent must be collected and recorded.

## Data Minimization
- Email bodies are truncated to 1,000 characters before processing.
- AI model receives only the data needed for the current task.
- No client data is sent to third parties beyond Google (Gmail/Calendar) and Anthropic (AI processing).

## Right of Access / Deletion
Under PIPEDA, individuals have the right to:
1. Know what personal information is held about them
2. Request correction of inaccurate information
3. Request deletion of their personal information

**To implement**: Add a `delete_client_data(email)` function that removes all PII for a given client from: `clients`, `bookings`, `inquiries`, `quotes`, `ai_ops_log`, `ai_processed_emails`.

## Encryption
- Data at rest: Neon Postgres (encrypted at rest by default)
- Data in transit: TLS enforced on all connections (Neon, Vercel, Gmail API, Anthropic API)
- No PII is stored in local files or browser storage

## AI Processing
- Anthropic's API has a zero-retention data policy for API usage
- Email content passed to the AI is ephemeral (not stored by Anthropic beyond the request)
- The AI cannot access data beyond what is provided in the current request context
