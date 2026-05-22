import fs from "fs";
import path from "path";

const OPS_DIR = path.join(process.cwd(), "data");
const OPS_LOG = path.join(OPS_DIR, "operations.json");
const PROCESSED_LOG = path.join(OPS_DIR, "processed_emails.json");

// ============================================================
// OPERATIONS LOG
// ============================================================
// This is the AI's persistent memory. It reads this file at
// the start of every cycle and writes to it after every action.
// Context is unreliable. This file is truth.
// ============================================================

export interface Operation {
  id: string;
  timestamp: string;
  type:
    | "email_received"
    | "email_sent"
    | "email_drafted"
    | "booking_created"
    | "booking_updated"
    | "booking_cancelled"
    | "reminder_sent"
    | "classification"
    | "error"
    | "verification_failed";
  emailId?: string;
  threadId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  classification?: string;
  calendarEventId?: string;
  details: string;
  verified: boolean;
}

export interface ProcessedEmail {
  messageId: string;
  threadId: string;
  processedAt: string;
  classification: string;
  actionTaken: string;
  operationIds: string[];
}

// --- Ensure data directory exists ---
function ensureDir() {
  if (!fs.existsSync(OPS_DIR)) {
    fs.mkdirSync(OPS_DIR, { recursive: true });
  }
}

// --- Operations Log ---
export function readOpsLog(): Operation[] {
  ensureDir();
  if (!fs.existsSync(OPS_LOG)) return [];
  try {
    return JSON.parse(fs.readFileSync(OPS_LOG, "utf-8"));
  } catch {
    return [];
  }
}

export function writeOpsLog(ops: Operation[]) {
  ensureDir();
  fs.writeFileSync(OPS_LOG, JSON.stringify(ops, null, 2));
}

export function appendOperation(op: Omit<Operation, "id" | "timestamp">): Operation {
  const ops = readOpsLog();
  const newOp: Operation = {
    ...op,
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  ops.push(newOp);
  writeOpsLog(ops);
  return newOp;
}

// --- Processed Emails ---
export function readProcessedEmails(): ProcessedEmail[] {
  ensureDir();
  if (!fs.existsSync(PROCESSED_LOG)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROCESSED_LOG, "utf-8"));
  } catch {
    return [];
  }
}

export function markEmailProcessed(entry: ProcessedEmail) {
  const processed = readProcessedEmails();
  processed.push(entry);
  ensureDir();
  fs.writeFileSync(PROCESSED_LOG, JSON.stringify(processed, null, 2));
}

export function isEmailProcessed(messageId: string): boolean {
  const processed = readProcessedEmails();
  return processed.some((p) => p.messageId === messageId);
}

// --- Queries ---
export function getRecentOperations(hours = 24): Operation[] {
  const ops = readOpsLog();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return ops.filter((op) => new Date(op.timestamp).getTime() > cutoff);
}

export function getOperationsByEmail(emailId: string): Operation[] {
  const ops = readOpsLog();
  return ops.filter((op) => op.emailId === emailId);
}

export function getTodaysBookings(): Operation[] {
  const ops = readOpsLog();
  const today = new Date().toISOString().split("T")[0];
  return ops.filter(
    (op) =>
      op.type === "booking_created" &&
      op.timestamp.startsWith(today)
  );
}

export function getOpsLogSummary(): string {
  const ops = readOpsLog();
  const recent = getRecentOperations(24);
  const processed = readProcessedEmails();

  return [
    `=== OPERATIONS LOG SUMMARY ===`,
    `Total operations: ${ops.length}`,
    `Last 24h: ${recent.length} operations`,
    `Processed emails: ${processed.length}`,
    `Last operation: ${ops.length > 0 ? ops[ops.length - 1].timestamp + " — " + ops[ops.length - 1].type + ": " + ops[ops.length - 1].details : "none"}`,
    ``,
    `Recent operations (last 24h):`,
    ...recent.slice(-10).map(
      (op) =>
        `  [${op.timestamp.slice(11, 19)}] ${op.type}: ${op.details.slice(0, 100)}`
    ),
    ``,
    `Recently processed emails:`,
    ...processed.slice(-5).map(
      (p) =>
        `  [${p.processedAt.slice(11, 19)}] ${p.classification}: ${p.actionTaken.slice(0, 80)}`
    ),
  ].join("\n");
}
