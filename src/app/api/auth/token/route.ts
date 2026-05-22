import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import fs from "fs";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "data", "token.json");

// After first login, save the refresh token so the cron can use it
// without a browser session active.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = (session as any).accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: "No access token" }, { status: 401 });
  }

  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify(
      {
        accessToken,
        savedAt: new Date().toISOString(),
        email: session.user?.email,
      },
      null,
      2
    )
  );

  return NextResponse.json({ success: true, message: "Token saved for automation." });
}

export async function GET() {
  if (!fs.existsSync(TOKEN_FILE)) {
    return NextResponse.json({ hasToken: false });
  }
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  return NextResponse.json({
    hasToken: true,
    email: data.email,
    savedAt: data.savedAt,
  });
}
