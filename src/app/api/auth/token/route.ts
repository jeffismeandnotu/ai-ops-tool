import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRefreshToken } from "@/lib/google-auth";

// Refresh tokens are now persisted to Neon on login (via the NextAuth
// jwt callback). This endpoint is kept for the dashboard to check
// whether a token exists — no filesystem writes.

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ success: true, message: "Refresh token is stored in the database on login. No action needed." });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ hasToken: false });
  }
  const email = session.user?.email;
  if (!email) {
    return NextResponse.json({ hasToken: false });
  }
  const token = await getRefreshToken(email);
  return NextResponse.json({
    hasToken: !!token,
    email,
  });
}
