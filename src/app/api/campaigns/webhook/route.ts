import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import {
  setRecipientBounced,
  setRecipientOptedOut,
  updateRecipientDelivered,
} from "@/lib/campaigns/audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifySvixSignature(
  rawBody: string,
  headers: {
    svixId: string | null;
    svixTimestamp: string | null;
    svixSignature: string | null;
  }
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const secretBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64"
  );

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes)
    .update(toSign)
    .digest("base64");

  const signatures = svixSignature.split(" ");
  return signatures.some((sig) => {
    const val = sig.startsWith("v1,") ? sig.slice(3) : sig;
    return val === expected;
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: true, note: "Webhook not configured, ignoring" },
      { status: 200 }
    );
  }

  const rawBody = await req.text();

  const verified = verifySvixSignature(rawBody, {
    svixId: req.headers.get("svix-id"),
    svixTimestamp: req.headers.get("svix-timestamp"),
    svixSignature: req.headers.get("svix-signature"),
  });

  if (!verified) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  let event: { type: string; data: any };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = event.data?.to?.[0] || event.data?.email;
  if (!email) {
    return NextResponse.json({ ok: true, note: "No email in event" });
  }

  switch (event.type) {
    case "email.bounced":
      await setRecipientBounced(email);
      break;
    case "email.complained":
      await setRecipientOptedOut(email);
      break;
    case "email.delivered":
    case "email.sent":
      await updateRecipientDelivered(email);
      break;
    default:
      break;
  }

  return NextResponse.json({ ok: true, type: event.type });
}
