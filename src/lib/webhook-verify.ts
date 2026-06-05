import * as crypto from "crypto";

// ============================================================
// GMAIL PUB/SUB OIDC TOKEN VERIFICATION
// ============================================================
// Google Pub/Sub push subscriptions can include an OIDC token in
// the Authorization header. This verifies the token against
// Google's tokeninfo endpoint. Falls back to shared-secret only
// if GMAIL_PUBSUB_AUDIENCE is not configured.
// ============================================================

export async function verifyGmailPubSubToken(
  authHeader: string | null,
  expectedAudience?: string
): Promise<{ valid: boolean; email?: string; reason?: string }> {
  const audience = expectedAudience || process.env.GMAIL_PUBSUB_AUDIENCE;
  if (!audience) {
    return { valid: true, reason: "OIDC not configured (no GMAIL_PUBSUB_AUDIENCE)" };
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, reason: "Missing or malformed Authorization header" };
  }

  const token = authHeader.slice(7);
  try {
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    );
    if (!resp.ok) {
      return { valid: false, reason: `Token verification failed: ${resp.status}` };
    }
    const info = await resp.json();

    if (info.aud !== audience) {
      return { valid: false, reason: `Audience mismatch: expected ${audience}, got ${info.aud}` };
    }

    if (!info.email_verified || info.email_verified !== "true") {
      return { valid: false, reason: "Token email not verified" };
    }

    return { valid: true, email: info.email };
  } catch (err: any) {
    return { valid: false, reason: `OIDC verification error: ${err.message}` };
  }
}

// ============================================================
// TWILIO SIGNATURE VERIFICATION
// ============================================================
// Reusable utility for verifying Twilio webhook requests.
// Not wired to a route yet — ready for when the SMS webhook
// endpoint is built.
//
// Standard algorithm: HMAC-SHA1 of (webhook URL + sorted POST
// params), base64-encoded, compared to X-Twilio-Signature header.
// ============================================================

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  if (!authToken || !signature) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data, "utf-8")
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf-8"),
    Buffer.from(signature, "utf-8")
  );
}

// ============================================================
// CRON_SECRET HEADER VERIFICATION
// ============================================================
// Centralizes secret comparison with timing-safe equality to
// prevent timing side-channels on the shared secret.
// ============================================================

export function verifyCronSecret(
  provided: string | null | undefined
): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf-8"),
      Buffer.from(provided, "utf-8")
    );
  } catch {
    return false;
  }
}
