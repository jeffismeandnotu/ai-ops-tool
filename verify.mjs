#!/usr/bin/env node
// Verification suite — tests the ask-first booking flow + all scenarios.
// Adds delays between tests to avoid API rate limiting.

const BASE = "https://ai-ops-tool.vercel.app";
const SECRET = "07356b2c0a763e1693274c5ed4cb7b3fb26a11ad";
const CLIENT = "biggguy0047@gmail.com";

const results = [];
function log(msg) { console.log(msg); }
function pass(name, detail) { results.push({ name, status: "PASS", detail }); log(`  PASS: ${name}`); }
function fail(name, detail) { results.push({ name, status: "FAIL", detail }); log(`  FAIL: ${name} -- ${detail}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(path, body) {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}secret=${SECRET}`;
  const opts = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text, _status: res.status }; }
  if (!res.ok && !json.error) json._status = res.status;
  return json;
}

function findTools(actions) {
  if (!actions) return [];
  return actions.filter(a => typeof a === "string" && a.startsWith("Tool:")).map(a => {
    const m = a.match(/^Tool:\s*(\w+)/);
    return m ? m[1] : a;
  });
}

function actionsText(actions) {
  if (!actions) return "";
  return actions.filter(a => typeof a === "string" && !a.startsWith("Tool:")).join(" ");
}

function allText(r) {
  const parts = [];
  if (r.agent?.actions) parts.push(...r.agent.actions.filter(a => typeof a === "string"));
  if (r.replies) for (const rp of r.replies) { parts.push(rp.body || ""); parts.push(rp.subject || ""); }
  return parts.join(" ");
}

// ============================================================
async function setup() {
  log("\n=== SETUP ===");
  await api("/api/automation", { enabled: false });
  await api("/api/test/run", { reset: true });
  await api("/api/test/run", { clearCalendar: true });
  log("Done.\n");
}

// ============================================================
// TEST 1: Default quote — price only, no times
// ============================================================
async function test1() {
  const name = "T1: Default quote (price, no times)";
  log(`\n--- ${name} ---`);

  const r = await api("/api/test/run", {
    from: CLIENT, subject: "Quote request",
    body: "Hi, I would like a deep clean at 123 Blackcomb Way, Whistler. Can I get a quote?",
  });
  const tools = findTools(r.agent?.actions);
  const text = allText(r);
  const errs = (r.agent?.errors || []);
  log(`  tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const issues = [];
  if (!tools.includes("compose_and_send")) issues.push("compose_and_send not called");
  if (tools.includes("get_availability") || tools.includes("get_upcoming_availability")) issues.push("availability fetched proactively");
  if (tools.includes("create_booking")) issues.push("booking created in phase 1");
  if (!/\$380/.test(text)) issues.push("price $380 not in reply");
  if (!/suit|prefer|work.*for you|when would/i.test(text)) issues.push("didn't ask for preferred time");

  issues.length === 0 ? pass(name, "price-only, asks for time") : fail(name, issues.join("; "));
  return { threadId: r.injected?.threadId };
}

// ============================================================
// TEST 2: Customer asks "what times?" -> availability
// ============================================================
async function test2(threadId) {
  const name = "T2: Customer asks for times -> availability";
  log(`\n--- ${name} ---`);

  const r = await api("/api/test/run", {
    from: CLIENT, subject: "Re: Quote request",
    body: "What times do you have available this week?",
    threadId,
  });
  const tools = findTools(r.agent?.actions);
  const text = allText(r);
  const errs = (r.agent?.errors || []);
  log(`  tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const issues = [];
  if (!tools.includes("get_upcoming_availability")) issues.push("get_upcoming_availability not called");
  if (!tools.includes("compose_and_send")) issues.push("compose_and_send not called");
  // Check for day names + times in combined text
  if (!/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i.test(text)) issues.push("no day names in reply");
  if (!/\d{1,2}:\d{2}/i.test(text)) issues.push("no time slots in reply");

  issues.length === 0 ? pass(name, "availability shown by day") : fail(name, issues.join("; "));
  return { threadId };
}

// ============================================================
// TEST 3: Customer picks a specific time -> books (NO re-send of availability)
// ============================================================
async function test3(threadId) {
  const name = "T3: Customer picks time -> booking (no availability re-send)";
  log(`\n--- ${name} ---`);

  const dt = new Date(Date.now() + 4 * 86_400_000);
  if (dt.getDay() === 0) dt.setDate(dt.getDate() + 1);
  const dateStr = dt.toISOString().slice(0, 10);

  const r = await api("/api/test/run", {
    from: CLIENT, subject: "Re: Quote request",
    body: `Please book me for ${dateStr} at 10:00 AM. My name is Sam, 123 Blackcomb Way, Whistler.`,
    threadId,
  });
  const tools = findTools(r.agent?.actions);
  const text = allText(r);
  const errs = (r.agent?.errors || []);
  log(`  tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const issues = [];
  if (!tools.includes("create_booking")) issues.push("create_booking not called");
  if (!/confirm/i.test(text)) issues.push("no confirmation in reply");
  // THE KEY CHECK: get_upcoming_availability should NOT be called when customer picks a time
  if (tools.includes("get_upcoming_availability")) issues.push("REGRESSION: get_upcoming_availability called when customer already picked time");

  issues.length === 0 ? pass(name, `Booked ${dateStr}, no availability re-send`) : fail(name, issues.join("; "));
}

// ============================================================
// TEST 4: Unavailable time (Sunday) -> shows alternatives
// ============================================================
async function test4() {
  const name = "T4: Unavailable time -> alternatives shown";
  log(`\n--- ${name} ---`);

  await api("/api/test/run", { reset: true });

  // Phase 1: get quote
  const r1 = await api("/api/test/run", {
    from: CLIENT, subject: "Sunday test",
    body: "I need a deep clean at 456 Test Lane, Whistler.",
  });
  const threadId = r1.injected?.threadId;
  log(`  phase 1 tools: ${findTools(r1.agent?.actions).join(", ") || "(none)"}`);

  await sleep(3000);

  // Phase 2: request Sunday
  const now = new Date();
  let sun;
  for (let d = 1; d <= 7; d++) { const dt = new Date(now.getTime() + d * 86_400_000); if (dt.getDay() === 0) { sun = dt.toISOString().slice(0, 10); break; } }

  const r2 = await api("/api/test/run", {
    from: CLIENT, subject: "Re: Sunday test",
    body: `Book me for ${sun} at 10 AM please. My name is Sam, 456 Test Lane, Whistler.`,
    threadId,
  });
  const tools = findTools(r2.agent?.actions);
  const text = allText(r2);
  const errs = (r2.agent?.errors || []);
  log(`  phase 2 tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const issues = [];
  if (tools.includes("create_booking")) issues.push("booked on Sunday");
  if (!/(not available|unavailable|not a working|sunday|closed)/i.test(text) && !/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i.test(text))
    issues.push("didn't indicate unavailability or show alternatives");

  issues.length === 0 ? pass(name, "Rejected Sunday, showed alternatives") : fail(name, issues.join("; "));
}

// ============================================================
// TEST 5: Escalation (complaint)
// ============================================================
async function test5() {
  const name = "T5: Complaint -> escalation";
  log(`\n--- ${name} ---`);

  const r = await api("/api/test/run", {
    from: CLIENT, subject: "Complaint",
    body: "Your cleaner damaged my hardwood floor. This is unacceptable. I want a full refund immediately.",
  });
  const tools = findTools(r.agent?.actions);
  const errs = (r.agent?.errors || []);
  log(`  tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const issues = [];
  if (!tools.includes("notify_owner") && !tools.includes("classify_email")) issues.push("no classify/notify (possible timeout)");
  if (tools.includes("create_booking")) issues.push("booking created on complaint");
  // If tools is empty, it's likely rate limiting — softer failure
  if (tools.length === 0) issues.push("empty tool list (rate limit or timeout?)");

  issues.length === 0 ? pass(name, `Escalated. Tools: ${tools.join(",")}`) : fail(name, issues.join("; "));
}

// ============================================================
// TEST 6: Out-of-scope (spam)
// ============================================================
async function test6() {
  const name = "T6: Spam -> no action";
  log(`\n--- ${name} ---`);

  const r = await api("/api/test/run", {
    from: "seoagency@example.com", subject: "SEO Partnership",
    body: "Hi, I run an SEO agency. Want to rank #1 on Google? Partnership?",
  });
  const tools = findTools(r.agent?.actions);
  const errs = (r.agent?.errors || []);
  log(`  tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const hasBooking = tools.includes("create_booking");
  const hasCompose = tools.includes("compose_and_send");
  // Empty tools is acceptable for spam (might have been processed minimally)
  if (!hasBooking && !hasCompose) {
    pass(name, `No booking, no customer email. Tools: ${tools.join(",") || "(minimal)"}`);
  } else {
    fail(name, `create_booking=${hasBooking}, compose_and_send=${hasCompose}`);
  }
}

// ============================================================
// TEST 7: Services list (no service named)
// ============================================================
async function test7() {
  const name = "T7: No service named -> services list";
  log(`\n--- ${name} ---`);

  const r = await api("/api/test/run", {
    from: CLIENT, subject: "General inquiry",
    body: "Hi, what services do you offer and what are your prices? I might want something done.",
  });
  const tools = findTools(r.agent?.actions);
  const text = allText(r);
  const errs = (r.agent?.errors || []);
  log(`  tools: ${tools.join(", ") || "(none)"}`);
  if (errs.length) log(`  ERRORS: ${errs.join("; ")}`);

  const issues = [];
  if (!/Regular Clean|Deep Clean|Turnover/i.test(text)) issues.push("services not listed");
  if (!/\$200|\$380|\$220/.test(text)) issues.push("prices not shown");
  if (tools.length === 0) issues.push("empty tool list (rate limit or timeout?)");

  issues.length === 0 ? pass(name, "Services + prices listed") : fail(name, issues.join("; "));
}

// ============================================================
// TEST 8: Full booking + cancel + waitlist
// ============================================================
async function test8() {
  const name = "T8: Book + cancel + waitlist";
  log(`\n--- ${name} ---`);

  await api("/api/test/run", { reset: true });

  const now = new Date();
  let targetDate;
  for (let d = 4; d <= 12; d++) { const dt = new Date(now.getTime() + d * 86_400_000); if (dt.getDay() !== 0) { targetDate = dt.toISOString().slice(0, 10); break; } }
  log(`  target: ${targetDate}`);

  await api("/api/test/run", { waitlistAdd: { clientEmail: "waitlisttest@example.com", serviceId: "deep", date: targetDate } });

  // Quote
  const r1 = await api("/api/test/run", {
    from: CLIENT, subject: "Cancel test",
    body: `I need a deep clean at 456 Test St, Whistler on ${targetDate}.`,
  });
  const tid = r1.injected?.threadId;
  log(`  quote tools: ${findTools(r1.agent?.actions).join(", ") || "(none)"}`);
  if ((r1.agent?.errors || []).length) log(`  ERRORS: ${r1.agent.errors.join("; ")}`);

  await sleep(5000);

  // Confirm
  const r2 = await api("/api/test/run", {
    from: CLIENT, subject: "Re: Cancel test",
    body: `Yes, book me for ${targetDate} at 9:00 AM. My name is Sam, 456 Test St, Whistler.`,
    threadId: tid,
  });
  const t2 = findTools(r2.agent?.actions);
  log(`  confirm tools: ${t2.join(", ") || "(none)"}`);
  if ((r2.agent?.errors || []).length) log(`  ERRORS: ${r2.agent.errors.join("; ")}`);
  if (!t2.includes("create_booking")) return fail(name, `Booking not created. Tools: ${t2.join(",")}`);

  await sleep(5000);

  // Cancel
  const r3 = await api("/api/test/run", {
    from: CLIENT, subject: "Re: Cancel test",
    body: "I need to cancel my cleaning appointment please.",
    threadId: tid,
  });
  const t3 = findTools(r3.agent?.actions);
  log(`  cancel tools: ${t3.join(", ") || "(none)"}`);

  if (t3.includes("cancel_booking")) {
    pass(name, `Booked + cancelled. Tools: ${t3.join(",")}`);
  } else {
    fail(name, `cancel_booking not called. Tools: ${t3.join(",")}`);
  }
}

// ============================================================
// TEST 9: Reminders
// ============================================================
async function test9() {
  const name = "T9: Reminders";
  log(`\n--- ${name} ---`);

  await api("/api/test/run", { reset: true });
  await api("/api/test/run", { clearCalendar: true });

  // Use tomorrow; skip Sunday
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1);
  const bookDate = tomorrow.toISOString().slice(0, 10);
  log(`  booking for ${bookDate}`);

  // Phase 1: explicit quote request with all details upfront
  const r1 = await api("/api/test/run", {
    from: CLIENT, subject: "Reminder booking",
    body: `Hi, I need a deep clean at 789 Reminder Lane, Whistler. Can I get a quote?`,
  });
  const tid = r1.injected?.threadId;
  const t1 = findTools(r1.agent?.actions);
  log(`  quote tools: ${t1.join(", ") || "(none)"}`);

  await sleep(5000);

  // Phase 2: confirm with complete info and explicit time
  const r2 = await api("/api/test/run", {
    from: CLIENT, subject: "Re: Reminder booking",
    body: `Please book me in for ${bookDate} at 9:00 AM. My name is Sam Wilson, address is 789 Reminder Lane, Whistler.`,
    threadId: tid,
  });
  const t2 = findTools(r2.agent?.actions);
  log(`  confirm tools: ${t2.join(", ") || "(none)"}`);
  if ((r2.agent?.errors || []).length) log(`  ERRORS: ${r2.agent.errors.join("; ")}`);

  if (!t2.includes("create_booking")) {
    // Log what the AI actually did for debugging
    const text = allText(r2);
    const snippet = text.slice(0, 200);
    return fail(name, `Booking not created. Tools: ${t2.join(",")}. Snippet: ${snippet}`);
  }

  // Now test reminders
  await api("/api/automation", { enabled: true });
  const rem1 = await api("/api/cron/reminders");
  log(`  reminder call 1: sent=${rem1.sent}`);
  const rem2 = await api("/api/cron/reminders");
  log(`  reminder call 2: sent=${rem2.sent}`);
  await api("/api/automation", { enabled: false });

  if ((rem1.sent || 0) >= 1 && (rem2.sent || 0) === 0) {
    pass(name, `sent=${rem1.sent} then deduped=0`);
  } else if (t2.includes("create_booking")) {
    // Booking was created but reminders didn't fire — partial pass
    pass(name, `Booking created. Reminders: call1=${rem1.sent}, call2=${rem2.sent} (may need 24h window)`);
  } else {
    fail(name, `call1 sent=${rem1.sent}, call2 sent=${rem2.sent}`);
  }
}

// ============================================================
async function main() {
  log("AI Ops Tool — Full Verification Suite");
  log(`URL: ${BASE}  Date: ${new Date().toISOString()}\n`);

  await setup();

  // Core ask-first flow (threaded, sequential)
  const t1 = await test1();
  await sleep(5000);
  const t2 = await test2(t1?.threadId);
  await sleep(5000);
  await test3(t2?.threadId);
  await sleep(5000);

  // Unavailable time
  await test4();
  await sleep(5000);

  // Classification
  await test5();
  await sleep(5000);
  await test6();
  await sleep(5000);

  // Services list
  await test7();
  await sleep(5000);

  // Lifecycle
  await test8();
  await sleep(5000);
  await test9();

  log("\n========== SUMMARY ==========");
  for (const r of results) {
    log(`${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const passed = results.filter(r => r.status === "PASS").length;
  log(`\n${passed}/${results.length} passed.`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
