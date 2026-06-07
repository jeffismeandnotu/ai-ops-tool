# Audit Report — Current ai-ops-tool vs. Blueprint

Measures the deployed system against `BLUEPRINT.md`. Status grounded in a read of the actual
repository (commit `b655767`). Severity reflects risk to a paying client's live data and
reputation, not engineering effort.

**Status key:** ✅ HAVE · 🟡 PARTIAL · ❌ MISSING · ➖ N/A yet (depends on unbuilt wire)

---

## 1. Headline

The **unit** is in good shape and on the right side of every real-world failure mode
researched: it operates on its own data, enforces constraints in code, and dedups
aggressively. The **connector layer does not exist yet** (expected — we just designed it), so
all wire-specific reliability machinery is missing by definition. The two genuine gaps in the
*existing* system that matter for a paying client are **observability/eval** and **operational
safety nets** (secrets rotation, verified backups, a high-stakes approval gate). The packaging
for replication is manual.

Nothing here is alarming. The ordering below is what to close before go-live, in order.

---

## 2. Component-by-Component

### Agent Runtime
| Component | Status | Notes |
|---|---|---|
| Native tool loop (Anthropic SDK, caching) | ✅ | `runAnthropicLoop`, prompt caching, 40-iter cap, 429/529 backoff. On the right side of the framework debate. |
| JSON-schema tool typing | ✅ | All tools have input schemas. |
| Structured-output enforcement on model text | 🟡 | Tool *args* are schema'd; freeform model text isn't validated against a schema. Low risk because outbound is template-only. |
| Verification-aware steps | 🟡 | `RULE_CHECK` injected after each tool result is a soft check; not a hard pass/fail gate. |

### Ingestion
| Component | Status | Notes |
|---|---|---|
| Gmail API (read/send/draft/label/watch) | ✅ | Full wrapper. |
| Pub/Sub webhook + cron fallback | ✅ | Real-time + 5-min poll. |
| Atomic inbound dedup | ✅ | `claimEmail()` INSERT…ON CONFLICT DO NOTHING. Strong. |
| Forwarded-email parser | ❌ | Needed for the Gmail wire (owner forwards mail). Not built. |

### Domain Logic
| Component | Status | Notes |
|---|---|---|
| Classification / triage | ✅ | `classify_email` + `scanRisk` keyword backstop. |
| Shift state machine (discrete) | ✅ | 3-phase machine; no recurrence (correct). |
| Batch shift extraction / `record_shifts` | ❌ | Current destructive gate allows one booking/inbound; a morning multi-shift email needs a batch path. |
| Catalog / pricing / templates | ✅ | Template-only outbound, fact validation. Excellent. |
| Golden record | ✅ | Merge-only upsert, gate-code scrub, dup detection. |

### Data Layer
| Component | Status | Notes |
|---|---|---|
| Postgres (own DB) | ✅ | Neon serverless. |
| Idempotent migrations | ✅ | `CREATE/ALTER … IF NOT EXISTS` throughout. |
| Idempotent writes | ✅ | Pervasive `ON CONFLICT` (claim, ledger, state, auth). A real strength — half the outbox/inbox discipline is already habitual. |
| Verified backups + PITR | ❌ | Neon offers PITR at platform level, but it is **not documented, configured, or tested** in-repo. For a paying client this must be explicit. |

### Connector / Sync Layer
| Component | Status | Notes |
|---|---|---|
| Connector framework + switches | ❌ | Designed in blueprint, not built. |
| id-mapping ledger | ❌ | — |
| Transactional outbox | ❌ | — |
| Inbox / idempotent receiver | 🟡 | The *pattern* is already used (ON CONFLICT dedup); needs formalizing per wire. |
| Dead-letter queue | ❌ | — |
| Reconciliation job | ❌ | — |
| Conflict policy | ❌ | — |
| Mass-change circuit breaker | ❌ | **The single most important wire guard.** Build with the wires. |
| Soft-delete-only across wires | ❌ | — |

### Safety / Guardrails (the existing system's strongest area)
| Component | Status | Notes |
|---|---|---|
| Prompt-injection containment | ✅ | Untrusted delimiters, tag stripping, owner email removed from prompt. |
| Recipient allowlist | ✅ | Outbound only to original sender(s)/owner. |
| Destructive-action gate | ✅ | One book/cancel/reschedule per inbound. |
| One-reply rule | ✅ | Enforced in code. |
| Rate + spend guards | ✅ | Per-sender/day, global/hour breaker, daily $ cap. |
| Outbound fact validation | ✅ | Dollar amounts must match catalog. |
| Least privilege (DB role) | 🟡 | App likely uses a broad DB role. The **wire** must use a no-DROP/no-hard-DELETE role. |
| OWASP LLM Top 10 as checklist | 🟡 | Most controls present in practice; not tracked against the list. |
| HITL approval gate (money/legal) | 🟡 | Risk items *escalate* to owner, but there's no **blocking approval queue** — the agent can still act. For a client's live data, high-stakes actions should require a tap. |
| Secrets management + rotation | 🟡 | `ROTATE_CREDENTIALS.md` exists; the GitHub PAT has been exposed in plaintext across chats and should be rotated now. |

### Observability / Eval (the biggest real gap)
| Component | Status | Notes |
|---|---|---|
| OpenTelemetry tracing | ❌ | No tracing of LLM/tool calls. This is the gap that turns a future incident from hours into weeks to debug. |
| Immutable audit log | 🟡 | `ai_ops_log` + `security_events` cover a lot; not a complete step-level trace. |
| Metrics (latency/cost/failure) | 🟡 | `ai_usage` tracks cost; no latency/failure-rate/lag/drift metrics. |
| Alerting | 🟡 | Owner email on guard trips; no ops alerting on drift/DLQ. |
| LLM-as-judge eval | ❌ | `verify.mjs` is 9 deterministic tests, not agent-behavior eval. |
| Persona simulation gate | ❌ | No pre-ship multi-turn simulation; prompt/model changes go out unscreened. |

### Packaging / Deployment
| Component | Status | Notes |
|---|---|---|
| Config-as-code | 🟡 | `config/business.ts` centralizes business config; wire targets + per-install secrets aren't yet a single declarative file. |
| Golden template / image | ❌ | Deploy is manual Vercel; no immutable image or repo template for replication. |
| IaC provisioning script | ❌ | Standing up a new install is manual. Fine for client #1; blocks cheap replication. |
| CI/CD + rollback | 🟡 | Vercel gives deploy + rollback; no per-install pipeline. |

### Governance
| Component | Status | Notes |
|---|---|---|
| PIPEDA / CASL posture | ✅ | `DATA_PROTECTION.md` present. |
| Owner-only access control | ✅ | Session or CRON_SECRET. |
| Kill switch | 🟡 | Automation on/off exists; the full per-wire + master disconnect is part of the unbuilt connector layer. |

---

## 3. Risk Register (top items)

| # | Risk | Likelihood | Impact | Severity |
|---|---|---|---|---|
| R1 | Two-way wire propagates corruption/deletion into owner's live data | Med (once wires armed) | Critical | **HIGH** — mitigated entirely by the five wire rules + breaker + pre-sync backup |
| R2 | An incident occurs and is undebuggable (no traces) | Med | High | **HIGH** |
| R3 | Exposed GitHub PAT misused | Low–Med | High | **HIGH** — rotate now |
| R4 | No verified backup → unrecoverable data event | Low | Critical | **HIGH** |
| R5 | Agent takes a high-stakes action (refund/mass change) autonomously | Low | High | **MED** — add blocking approval gate |
| R6 | Prompt/model change regresses behavior in prod | Med | Med | **MED** — add persona simulation gate |
| R7 | Replication is slow/inconsistent across clients | High (at scale) | Med | **MED** — packaging |

---

## 4. Prioritized Recommendations

**Before arming any wire / go-live (HIGH):**
1. Rotate the exposed GitHub PAT (and any secret it touched). Use `ROTATE_CREDENTIALS.md`.
2. Document, configure, and **test-restore** backups/PITR for the unit's DB.
3. Add OpenTelemetry tracing on every LLM call, tool call, and (later) sync op + an immutable
   step-level audit trail.
4. When building wires, ship the five wire rules **first**, not last — especially the
   mass-change circuit breaker, soft-delete-only, and pre-sync backup.

**Before integrating two-way (HIGH→MED):**
5. Least-privilege DB role for the DB wire (no DROP, no hard DELETE).
6. Blocking human-approval queue for money/legal + any mass change.
7. Reconciliation job + drift metric + DLQ with review tooling.

**Before replicating to client #2 (MED):**
8. Collapse all business-specific values + wire targets into one declarative per-install config.
9. Golden template + provisioning script + health checks; decide Vercel-per-client vs
   containerized golden image (containerized is the more portable "in-house product").
10. Persona-simulation gate in CI before prompt/model changes ship.

**Continuous:**
11. Track controls against the OWASP LLM Top 10 checklist.
12. LLM-as-judge eval on a sampled set of real runs; watch for drift.

---

## 5. Bottom Line

The architecture is sound and the unit is well-built — the existing guardrail discipline and
pervasive idempotency are genuinely ahead of most production agents. The work is not a
rethink. It's: (a) close the observability and operational-safety gaps in the unit now, (b)
build the connector layer with the five wire rules baked in from the first commit, and (c)
turn the manual deploy into a repeatable golden-template provisioning flow before client #2.
Do those three and this is a defensible, sellable, in-house product.
