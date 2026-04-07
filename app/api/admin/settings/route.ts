import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL, invalidateSystemPromptCache, invalidateClaudeModelCache, invalidateGeminiModelCache } from "@/lib/system-prompt";

export type AiProvider = "claude" | "gemini";

const VALID_CLAUDE_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
];

const VALID_GEMINI_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-pro-preview",
];

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
  const claudeModel: string = (data?.claudeModel as string) || DEFAULT_CLAUDE_MODEL;
  const geminiModel: string = (data?.geminiModel as string) || DEFAULT_GEMINI_MODEL;

  return NextResponse.json({ provider, systemPrompt, claudeModel, geminiModel });
}

// POST /api/admin/settings — updates provider and/or system prompt
// Body: { provider?: "claude" | "gemini", systemPrompt?: string }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { provider?: string; systemPrompt?: string; claudeModel?: string; geminiModel?: string };
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

  if (body.claudeModel !== undefined) {
    if (!VALID_CLAUDE_MODELS.includes(body.claudeModel)) {
      return NextResponse.json({ error: "Invalid Claude model" }, { status: 400 });
    }
    update.claudeModel = body.claudeModel;
    invalidateClaudeModelCache();
  }

  if (body.geminiModel !== undefined) {
    if (!VALID_GEMINI_MODELS.includes(body.geminiModel)) {
      return NextResponse.json({ error: "Invalid Gemini model" }, { status: 400 });
    }
    update.geminiModel = body.geminiModel;
    invalidateGeminiModelCache();
  }

  await db.collection("settings").doc("ai").set(update, { merge: true });

  const doc = await db.collection("settings").doc("ai").get();
  const data = doc.data();
  return NextResponse.json({
    provider: (data?.provider as AiProvider) ?? "claude",
    systemPrompt: (data?.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT,
    claudeModel: (data?.claudeModel as string) || DEFAULT_CLAUDE_MODEL,
    geminiModel: (data?.geminiModel as string) || DEFAULT_GEMINI_MODEL,
  });
}
