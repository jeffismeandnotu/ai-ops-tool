import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// Force NEXTAUTH_URL before NextAuth reads it
process.env.NEXTAUTH_URL = "https://ai-ops-tool.vercel.app";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
