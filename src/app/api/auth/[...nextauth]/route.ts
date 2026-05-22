import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

process.env.NEXTAUTH_URL = "https://ai-ops-tool-git-main-jeffismeandnotus-projects.vercel.app";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
