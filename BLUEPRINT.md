# Blueprint — Standalone In-House AI Ops Unit

A complete, end-to-end design for the ai-ops-tool as a **self-contained unit** that each
business owns outright (its own Gmail, Calendar, database, deployment), connected to that
business's existing systems through **three independent, switchable sync wires**. No SaaS,
no multi-tenancy — one isolated install per client, replicated on sale.

This document is the build contract: the component inventory, the reference architecture
(mapped to patterns proven in production at scale), the connector design, the safety and
reliability layer, observability, and the per-install packaging model. The companion
`AUDIT_REPORT.md` measures the current codebase against this blueprint.

---

## 0. Design Principles (non-negotiable)

1. **The unit never touches the owner's production systems directly.** It operates only on
   its own Gmail/Calendar/DB. All contact with the owner's systems goes through a controlled
   wire. (This is the single most important lesson from the 2025 Replit incident, where an
   agent with direct production-DB access dropped tables despite a code freeze.)
2. **Reliability comes from deterministic guardrails and state management, not prompts.**
   Every critical constraint is enforced in code, not asked for in the system prompt.
3. **Fail safe, fail visible.** Every action is logged immutably; nothing is silently
   dropped; the AI's own "success" claims are never trusted without independent verification.
4. **One switch fully detaches everything.** Wires off = the unit runs standalone and the
   owner's business runs exactly as it does today, untouched. Plug/unplug, not surgery.
5. **Every install is identical and config-driven.** Nothing business-specific is hardcoded;
   standing up client #N is a provisioning run, not a rebuild.

---

## 1. Comprehensive Component Inventory

Every component the full system needs, grouped by layer. Status against current code is in
`AUDIT_REPORT.md`.

### A. Agent Runtime
- **Native tool-calling loop** (Anthropic SDK direct, prompt caching). Industry has moved
  *away* from heavy frameworks (LangChain) toward native SDKs for production agents — simpler
  debugging, fewer hidden abstractions, code you understand in six months.
- **Structured outputs / JSON-schema tool typing** on every tool. Schema-checked tool args
  cut malformed tool calls substantially and are the first reliability layer.
- **Verification-aware steps** — pass/fail checks encoded per sub-task so the agent halts on
  bad facts instead of proceeding.
- **Bounded loop** — max iterations, per-step latency ceiling, one destructive action per
  inbound.

### B. Ingestion / Channels
- Gmail API: read, send, draft, label, search, history, watch.
- Gmail Pub/Sub push webhook (real-time) + cron poll (fallback).
- Forwarded-email parser (extract original sender + body from `Fwd:` messages).
- Atomic dedup on inbound (claim-once).
- SMS/Twilio channel (stub present; future).

### C. Domain Logic
- Email classification / risk triage.
- Shift/booking state machine — **discrete shifts only, no recurrence engine** (schedules
  vary day to day; clients email them in).
- Structured shift extraction (date, time, service, client, address, notes).
- Service catalog + pricing + working hours (business config).
- Deterministic outbound templates (model never writes email bodies).
- Availability / slot computation.
- Client golden record (merge-only upsert, gate-code scrubbing, duplicate detection).

### D. Data Layer (the unit's own DB)
- Postgres (Neon serverless).
- Schema: core business, operational, security, connector/ledger tables.
- Idempotent migrations (`CREATE TABLE IF NOT EXISTS` + `ALTER ... ADD COLUMN IF NOT EXISTS`).
- **Automated backups + point-in-time recovery**, tested.

### E. Connector / Sync Layer — the three wires
- **Connector framework**: shared interface every wire implements —
  `connect() / disconnect() / status() / syncOut() / syncIn()`.
- **Gmail wire** — owner forwards business mail to the unit's Gmail; unit ingests.
- **Calendar wire** — unit's Calendar ↔ owner's Google Calendar (one-way push first).
- **Schedule/DB wire** — unit's DB ↔ owner's website database.
- **id-mapping ledger** per wire (unit-side id ↔ owner-side id), unique-constrained.
- **Transactional outbox** (write business change + outbox row in one DB transaction).
- **Inbox / idempotent receiver** (record event id before applying; duplicates are no-ops).
- **Dead-letter queue** for events that fail after N retries — routed for review, never dropped.
- **Reconciliation job** — periodic full compare of both sides, drift report.
- **Conflict policy** — origin-authoritative by default (unit owns data it parsed, owner owns
  the rest), ambiguous → manual review queue, every resolution logged.
- **Mass-change circuit breaker** — a single sync that would alter > N% of records halts and
  alerts instead of executing.
- **Soft-delete-only across wires** — no hard delete ever crosses a wire.
- **Master switch + per-wire switches** (`connectors_master`, `connector_gmail`,
  `connector_calendar`, `connector_db`), all default OFF.

### F. Safety / Guardrails
- Prompt-injection containment (untrusted-data delimiters; strip injected tags).
- Recipient allowlist (outbound only to original sender + owner).
- Destructive-action gate (one book/cancel/reschedule per inbound).
- One-reply-per-inbound rule.
- Rate + spend guards (per-sender/day, global/hour circuit breaker, daily $ cap).
- Outbound fact validation (dollar amounts must match catalog).
- **Least privilege** (NIST AC-6): scoped OAuth, a DB role for the wire with no DROP/DELETE.
- **OWASP LLM Top 10** coverage as a checklist (injection, insecure output handling, excessive
  agency, etc.).
- **Human-in-the-loop approval gate** for high-stakes actions (refunds, mass changes, anything
  money/legal) — standard practice for reliable agents; EU AI Act Art. 14 mandates it for
  high-risk systems.
- Secrets management + scheduled rotation.
- Pre-sync backup of the owner's data before any wire run.

### G. Observability / Evaluation
- **OpenTelemetry tracing** — every LLM call, tool call, retrieval, and sync op is a span;
  the trace tree shows the full flow. OTel is now the default wire format, so this is
  vendor-neutral.
- Immutable structured audit log (timestamp, full payload, execution context).
- Metrics: latency, cost/run, failure rate, **outbox lag**, **sync drift**, guard trips.
- Alerting to owner + ops on guard trips / breaker / DLQ growth.
- **LLM-as-judge evaluation** — span-level scores (tool-use correctness, grounding) and
  trace-level scores (task completion). Automates quality assessment without manual review.
- **Persona-driven simulation** — multi-turn synthetic customers run before any prompt or
  model change ships.
- Drift / hallucination monitoring.

### H. Packaging / Deployment (per-install, replicable)
- **Config-as-code**: one config file per install — business name, services, pricing, hours,
  owner email, and the three wire targets (Gmail address, Calendar ID, owner DB connection).
  Nothing business-specific outside it.
- **Golden template** — immutable image / repo template, built once, deployed identically
  everywhere (Packer-style golden image or a versioned repo template + Docker).
- **IaC provisioning** — a script that stands up a full new install: provision the unit's
  Gmail, OAuth it, create its Calendar, set env, point the three wires, run health checks.
  Single-tenant "silo" provisioning is a well-supported, repeatable pattern.
- **CI/CD per install** with blue-green / one-click rollback.
- **Version pinning** across installs + a documented upgrade path.

### I. Governance / Compliance
- PIPEDA / CASL (Canada) data-protection posture (consent, retention, unsubscribe).
- Access control: owner-only (session or shared secret).
- Audit-log retention policy.
- Kill switch = full, clean disconnect.

---

## 2. Reference Architecture (assembled from proven patterns)

```
                     OWNER'S EXISTING BUSINESS (untouched)
        owner Gmail            owner Google Calendar         owner website DB
            |                          |                            |
        [ Gmail wire ]          [ Calendar wire ]            [ Schedule/DB wire ]
            |                          |                            |
            =============  CONNECTOR LAYER (switchable)  =============
            | outbox · inbox · idempotency keys · DLQ · reconciliation |
            | conflict policy · mass-change breaker · soft-delete-only |
            ===========================================================
                                   |
        +----------------------- THE UNIT (self-contained) ----------------------+
        |                                                                         |
        |   Ingestion            Agent Runtime            Domain Logic            |
        |   Gmail API            native tool loop         classify / triage       |
        |   Pub/Sub + cron       structured outputs       shift extraction        |
        |   forward parser       bounded, verified        templates (det.)        |
        |        \                     |                        /                 |
        |         \____________  Deterministic Guardrails  ____/                  |
        |                 (allowlist, gates, rate/spend, facts)                   |
        |                                   |                                     |
        |                          Data Layer (own Postgres)                      |
        |                  core · ops · security · ledger tables                  |
        |                                                                         |
        +-------------------------------------------------------------------------+
                                   |
                  Observability: OTel traces · audit log · metrics
                  · LLM-as-judge eval · persona simulation · alerting
```

**Why these choices, and who runs them:**

- **Native agent loop over frameworks** — the 2026 consensus for serious production agents;
  frontier models handle tool calling and multi-step reasoning natively, so the surviving
  frameworks are the minimal ones (OpenAI Agents SDK, Anthropic SDK). You already use the
  Anthropic SDK direct — keep it.
- **Deterministic guardrails + template-only outbound** — the Guardrails-AI / structured-output
  pattern: the prompt instructs, the code enforces. This is what separates a reliable agent
  from a "risk amplifier."
- **Transactional outbox + inbox + idempotency + DLQ** — the standard reliability stack for
  event-driven systems; Debezium/CDC is the gold-standard relay; Stripe-style reconciliation
  closes drift. This is exactly the machinery the sync wires need so a retry never duplicates
  and a failure never silently loses a shift.
- **Connector layer = self-built embedded-integration pattern** — mirrors what Merge / Nango /
  Paragon sell (auth → actions → triggers → sync), but built in-house so you own the OAuth
  tokens and avoid the lock-in where switching vendors forces every customer to re-authenticate.
- **OpenTelemetry + LLM-as-judge + simulation** — the production observability/eval surface
  (MLflow, LangSmith, FutureAGI patterns). Step-level traces are what make agent incidents
  debuggable in hours instead of weeks.
- **Golden image + IaC single-tenant provisioning** — the proven way to make "one isolated
  copy per customer" cheap and repeatable (Packer golden images, Terraform/Ansible, immutable
  infra, single-tenant silo CI/CD).

---

## 3. The Standalone Connectable Product

**The unit** is complete and runs on its own. **Integration is three wires**, not a merge —
each wire keeps the unit's copy and the owner's copy in step, then can be cut independently.

**Step-by-step integration (arm one wire at a time):**

- **Wire 0 — none armed.** Unit runs standalone. Owner's business untouched.
- **Wire 1 — Gmail.** Owner forwards business mail to the unit's Gmail; unit ingests shifts
  into its own DB + own Calendar. Owner eyeballs it against his own.
- **Wire 2 — Calendar.** Unit pushes into the owner's Google Calendar (one-way first) so his
  real calendar fills in live; later two-way.
- **Wire 3 — Schedule/DB.** Unit's schedule syncs with the owner's website database.
  (Implementation depends on the owner's stack — to be confirmed.)

**Replication to the next business** is a packaging operation: copy the golden template, drop
in a new per-install config, run the provisioning script, hand over. No code changes.

---

## 4. The Three Wires (detail)

Each wire implements the same interface and rides the same reliability machinery.

**Gmail wire** — inbound only at first. Owner forwards → unit detects forward, extracts
original sender + body → classify → extract shifts → write to own DB + own Calendar → email
owner a summary. No customer outbound during shadow.

**Calendar wire** — unit Calendar → owner Calendar. Phase 1 one-way push (owner sees the
unit's bookings appear). Phase 2 two-way: cleanest is the owner *shares* his calendar with the
unit's account (ACL) so the unit writes directly; alternative is scheduled API sync with the
id-mapping ledger. Two-way needs the full conflict policy + breaker.

**Schedule/DB wire** — unit DB ↔ owner website DB. Adapter depends on the owner's stack
(Postgres / MySQL / hosted SaaS API). The framework is stack-agnostic; only this adapter's
internals change. **Hard requirement:** the wire's DB credentials are a least-privilege role
with no destructive grants; deletes are soft only.

---

## 5. Safety & Reliability Layer (the five wire rules + agent guards)

**Wire rules (protect the owner's data):**
1. Never hard-delete across a wire — upsert or soft-flag only; real deletion needs a human tap.
2. Idempotent, ledgered writes — id-mapping + unique constraint; retries with exponential
   backoff; at-least-once delivery assumed, so consumers are idempotent.
3. Explicit conflict policy — origin-authoritative default; ambiguous → review queue; all
   resolutions logged.
4. Reconciliation + mass-change circuit breaker — periodic full compare; a sync touching
   > N% of records halts and alerts (the guard that would have stopped Replit).
5. Full action log + independent verification — never trust the AI's "done"; confirm against
   the system of record. Pre-sync backup before every run.

**Agent guards (already largely built — protect against misuse):** prompt-injection
containment, recipient allowlist, destructive-action gate, one-reply rule, rate/spend guards,
outbound fact validation, least-privilege OAuth, HITL approval for money/legal.

---

## 6. Observability & Eval

Minimum surface for production: OTel span per LLM/tool/sync call; immutable audit log;
metrics (latency, cost, failure rate, outbox lag, sync drift, guard trips); alerting on
breaker/DLQ/spend; LLM-as-judge scoring on a sampled set; persona simulation gate before any
prompt/model change ships; drift + hallucination monitoring. Treat the audit log as the
compliance record.

---

## 7. Build Sequence

1. **Harden the unit** — structured outputs on all tools, OTel tracing, eval harness, secrets
   rotation, verified backups/PITR.
2. **Connector framework + switches** — interface, ledger tables, master + per-wire flags
   (all OFF), outbox/inbox/DLQ scaffolding. Copy the campaign-engine isolation discipline.
3. **Gmail wire** — forward parser + batch shift ingestion (`record_shifts`) + owner summary,
   shadow mode (no customer outbound).
4. **Calendar wire** — one-way push, then two-way with conflict policy + breaker.
5. **Schedule/DB wire** — once owner's stack is known.
6. **Reliability hardening across wires** — reconciliation, breaker thresholds, pre-sync
   backups, DLQ review tooling.
7. **Packaging** — per-install config schema, golden template, provisioning script + health
   checks, CI/CD + rollback.
8. **Replicate** — stand up client #2 from the template to prove the packaging.

---

## 8. Open Decisions

- Owner's website DB stack (drives the DB-wire adapter).
- Two-way calendar method: ACL share vs scheduled API sync.
- Host model for replication: Vercel-per-client vs containerized golden image on a VPS/cloud
  (containerized is more portable and more "in-house product"; Vercel is faster to ship).
- Mass-change breaker threshold (start conservative, e.g. 10% or 20 records).
