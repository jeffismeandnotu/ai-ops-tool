import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

export interface SendOpts {
  scheduledAt?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface EmailSender {
  send(
    to: string,
    subject: string,
    body: string,
    opts?: SendOpts
  ): Promise<SendResult>;
}

function encodeSubject(s: string): string {
  return /[^\x00-\x7F]/.test(s)
    ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`
    : s;
}

async function getAccessToken(): Promise<string> {
  const email = process.env.OPS_GMAIL_ADDRESS;
  if (!email) throw new Error("OPS_GMAIL_ADDRESS not set");

  const sql = neon(process.env.DATABASE_URL!);
  const rows =
    await sql`SELECT refresh_token FROM ai_google_auth WHERE email = ${email} LIMIT 1`;
  const refreshToken = rows[0]?.refresh_token;
  if (!refreshToken) {
    throw new Error(
      `No refresh token for ${email}. Sign in via the app first.`
    );
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error(`Failed to refresh access token for ${email}`);
  return token;
}

export class GmailSender implements EmailSender {
  async send(
    to: string,
    subject: string,
    body: string,
    _opts?: SendOpts
  ): Promise<SendResult> {
    try {
      const accessToken = await getAccessToken();
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });
      const gmail = google.gmail({ version: "v1", auth });

      const hdrs = [
        `To: ${to}`,
        `Subject: ${encodeSubject(subject)}`,
        "Content-Type: text/plain; charset=utf-8",
      ];
      const raw = Buffer.from(hdrs.join("\r\n") + "\r\n\r\n" + body)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });

      return { ok: true, id: res.data.id || undefined };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  }
}

export class ResendSender implements EmailSender {
  private apiKey: string;
  private from: string;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error(
        "Resend not configured: RESEND_API_KEY environment variable is not set. " +
          "Set CAMPAIGN_EMAIL_PROVIDER=gmail or provide a Resend API key."
      );
    }
    this.apiKey = key;
    this.from =
      process.env.RESEND_FROM_ADDRESS ||
      process.env.OPS_GMAIL_ADDRESS ||
      "noreply@example.com";
  }

  async send(
    to: string,
    subject: string,
    body: string,
    opts?: SendOpts
  ): Promise<SendResult> {
    try {
      const payload: Record<string, unknown> = {
        from: this.from,
        to: [to],
        subject,
        text: body,
      };
      if (opts?.scheduledAt) {
        payload.send_at = opts.scheduledAt;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        return { ok: false, error: `Resend ${res.status}: ${err}` };
      }

      const data = await res.json();
      return { ok: true, id: data.id };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  }
}

export function getSender(): EmailSender {
  const provider = (
    process.env.CAMPAIGN_EMAIL_PROVIDER || "gmail"
  ).toLowerCase();
  if (provider === "resend") return new ResendSender();
  return new GmailSender();
}
