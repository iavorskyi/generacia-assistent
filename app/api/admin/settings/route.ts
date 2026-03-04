import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { DEFAULT_SYSTEM_PROMPT, invalidateSystemPromptCache } from "@/lib/system-prompt";

export type AiProvider = "claude" | "gemini";

// GET /api/admin/settings — returns current AI provider and system prompt
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const doc = await db.collection("settings").doc("ai").get();
  const data = doc.data();
  const provider: AiProvider = (data?.provider as AiProvider) ?? "claude";
  const systemPrompt: string = (data?.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT;

  return NextResponse.json({ provider, systemPrompt });
}

// POST /api/admin/settings — updates provider and/or system prompt
// Body: { provider?: "claude" | "gemini", systemPrompt?: string }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { provider?: string; systemPrompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const db = getAdminDb();
  const update: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: session.user.email ?? "unknown",
  };

  if (body.provider !== undefined) {
    if (body.provider !== "claude" && body.provider !== "gemini") {
      return NextResponse.json({ error: "provider must be 'claude' or 'gemini'" }, { status: 400 });
    }
    update.provider = body.provider;
  }

  if (body.systemPrompt !== undefined) {
    update.systemPrompt = body.systemPrompt.trim();
    invalidateSystemPromptCache();
  }

  await db.collection("settings").doc("ai").set(update, { merge: true });

  const doc = await db.collection("settings").doc("ai").get();
  const data = doc.data();
  return NextResponse.json({
    provider: (data?.provider as AiProvider) ?? "claude",
    systemPrompt: (data?.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT,
  });
}
