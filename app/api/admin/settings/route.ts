import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export type AiProvider = "claude" | "gemini";

// GET /api/admin/settings — returns current AI provider setting
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const doc = await db.collection("settings").doc("ai").get();
  const provider: AiProvider = (doc.data()?.provider as AiProvider) ?? "claude";

  return NextResponse.json({ provider });
}

// POST /api/admin/settings — updates AI provider setting
// Body: { provider: "claude" | "gemini" }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let provider: AiProvider;
  try {
    const body = await req.json();
    if (body.provider !== "claude" && body.provider !== "gemini") {
      return NextResponse.json({ error: "provider must be 'claude' or 'gemini'" }, { status: 400 });
    }
    provider = body.provider;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const db = getAdminDb();
  await db.collection("settings").doc("ai").set({
    provider,
    updatedAt: new Date(),
    updatedBy: session.user.email ?? "unknown",
  });

  return NextResponse.json({ provider });
}
