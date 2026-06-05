import { google } from "googleapis";

export function getGmailClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth });
}

// --- Read ---
export async function searchEmails(
  accessToken: string,
  query: string,
  maxResults = 20
) {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.threads.list({
    userId: "me",
    q: query,
    maxResults,
  });
  return res.data.threads || [];
}

export async function getThread(accessToken: string, threadId: string) {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  return res.data;
}

export async function getRecentEmails(
  accessToken: string,
  maxResults = 10
) {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: "in:inbox -category:promotions -category:social",
  });

  if (!res.data.messages) return [];

  const emails = await Promise.all(
    res.data.messages.map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "full",
      });
      return parseMessage(full.data);
    })
  );

  return emails;
}

// --- Write ---
export async function createDraft(
  accessToken: string,
  to: string[],
  subject: string,
  body: string,
  cc?: string[],
  replyToMessageId?: string,
  threadId?: string
) {
  const gmail = getGmailClient(accessToken);

  const headerLines = [
    `To: ${to.join(", ")}`,
    cc?.length ? `Cc: ${cc.join(", ")}` : "",
    `Subject: ${subject}`,
    replyToMessageId ? `In-Reply-To: ${replyToMessageId}` : "",
    replyToMessageId ? `References: ${replyToMessageId}` : "",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\r\n");

  const encodedMessage = Buffer.from(headerLines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId: threadId || undefined,
      },
    },
  });

  return draft.data;
}

export async function sendDraft(accessToken: string, draftId: string) {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id: draftId },
  });
  return res.data;
}

export async function sendEmail(
  accessToken: string,
  to: string[],
  subject: string,
  body: string,
  cc?: string[],
  replyToMessageId?: string,
  threadId?: string
) {
  const gmail = getGmailClient(accessToken);

  const headerLines = [
    `To: ${to.join(", ")}`,
    cc?.length ? `Cc: ${cc.join(", ")}` : "",
    `Subject: ${subject}`,
    replyToMessageId ? `In-Reply-To: ${replyToMessageId}` : "",
    replyToMessageId ? `References: ${replyToMessageId}` : "",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ]
    .filter(Boolean)
    .join("\r\n");

  const encodedMessage = Buffer.from(headerLines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
      threadId: threadId || undefined,
    },
  });

  return res.data;
}

// --- Labels ---
export async function labelThread(
  accessToken: string,
  threadId: string,
  labelIds: string[]
) {
  const gmail = getGmailClient(accessToken);
  await gmail.users.threads.modify({
    userId: "me",
    id: threadId,
    requestBody: { addLabelIds: labelIds },
  });
}

export async function getLabels(accessToken: string) {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.labels.list({ userId: "me" });
  return res.data.labels || [];
}

// --- Push notifications (watch) ---
export async function watchMailbox(accessToken: string, topicName: string) {
  const gmail = getGmailClient(accessToken);
  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    },
  });
  // { historyId, expiration }
  return res.data;
}

export async function stopWatch(accessToken: string) {
  const gmail = getGmailClient(accessToken);
  await gmail.users.stop({ userId: "me" });
}

// Returns the message IDs added since startHistoryId (INBOX only).
export async function listAddedMessageIds(
  accessToken: string,
  startHistoryId: string
): Promise<string[]> {
  const gmail = getGmailClient(accessToken);
  const ids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      labelId: "INBOX",
      pageToken,
    });
    for (const h of res.data.history || []) {
      for (const m of h.messagesAdded || []) {
        const msg = m.message;
        if (!msg?.id) continue;
        const labels = msg.labelIds || [];
        // Skip our own sent mail and drafts so we never reply to ourselves.
        if (labels.includes("SENT") || labels.includes("DRAFT")) continue;
        ids.add(msg.id);
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return [...ids];
}

export async function getMessage(accessToken: string, messageId: string) {
  const gmail = getGmailClient(accessToken);
  const full = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return parseMessage(full.data);
}

// --- Helpers ---
function parseMessage(message: any) {
  const headers = message.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
      ?.value || "";

  let body = "";
  if (message.payload?.body?.data) {
    body = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
  } else if (message.payload?.parts) {
    const textPart = message.payload.parts.find(
      (p: any) => p.mimeType === "text/plain"
    );
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
    }
  }

  return {
    id: message.id,
    threadId: message.threadId,
    messageId: getHeader("Message-ID") || getHeader("Message-Id"),
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    snippet: message.snippet,
    body,
    labelIds: message.labelIds || [],
  };
}

// --- Test helpers (inject a realistic inbound + read the latest sent reply) ---
export async function insertInbound(
  accessToken: string,
  opts: { from: string; to: string; subject: string; body: string }
) {
  const gmail = getGmailClient(accessToken);
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <test-${Date.now()}@gmail.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body,
  ].join("\r\n");
  const raw = Buffer.from(headers).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await gmail.users.messages.insert({
    userId: "me",
    requestBody: { raw, labelIds: ["INBOX", "UNREAD"] },
  });
  return res.data; // { id, threadId }
}

export async function getRecentSent(accessToken: string, n = 4) {
  const gmail = getGmailClient(accessToken);
  const list = await gmail.users.messages.list({ userId: "me", q: "in:sent", maxResults: n });
  const msgs = list.data.messages || [];
  const out = [];
  for (const m of msgs) {
    const full = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" });
    out.push(parseMessage(full.data));
  }
  return out;
}
