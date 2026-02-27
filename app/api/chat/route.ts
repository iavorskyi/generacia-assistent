import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { selectDocuments } from "@/lib/document-selector";
import { chatWithCachedContext, calculateCost, ChatMessage } from "@/lib/claude";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { query, conversationId } = await request.json();

  if (!query?.trim()) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  const db = getAdminDb();

  // Load or create conversation
  let convRef;
  let conversationHistory: ChatMessage[] = [];

  if (conversationId) {
    convRef = db.collection("conversations").doc(conversationId);
    const convDoc = await convRef.get();

    if (convDoc.exists) {
      const data = convDoc.data()!;
      // Verify ownership
      if (data.userId !== session.user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      conversationHistory = data.messages || [];
    } else {
      // Conversation not found, create new
      convRef = db.collection("conversations").doc();
    }
  } else {
    convRef = db.collection("conversations").doc();
  }

  // Select relevant documents (with cache awareness)
  const { documents, fromCache } = await selectDocuments(
    query,
    convRef.id === conversationId ? conversationId : null
  );

  if (documents.length === 0) {
    return NextResponse.json(
      {
        error:
          "No documents available. Please ask an admin to upload company documents first.",
      },
      { status: 404 }
    );
  }

  // Call Claude with prompt caching
  const result = await chatWithCachedContext(
    query,
    documents,
    conversationHistory
  );

  const cost = calculateCost(result.usage);

  // Build updated conversation
  const newMessages: ChatMessage[] = [
    ...conversationHistory,
    { role: "user", content: query },
    { role: "assistant", content: result.answer },
  ];

  // Calculate cache expiry (5 minutes from now)
  const cacheValidUntil = new Date(Date.now() + 5 * 60 * 1000);

  // Save conversation
  await convRef.set(
    {
      userId: session.user.id,
      messages: newMessages.slice(-20), // keep last 20 messages
      cachedDocumentIds: fromCache
        ? undefined
        : documents.map((d) => d.id),
      cacheValidUntil: fromCache ? undefined : cacheValidUntil,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Track usage metrics (fire and forget)
  trackUsage(db, result.usage, cost).catch(console.error);

  return NextResponse.json({
    answer: result.answer,
    citations: result.citations,
    conversationId: convRef.id,
    cacheStatus: result.cacheStatus,
    fromCache,
    documentsUsed: documents.length,
    usage: result.usage,
    cost,
  });
}

async function trackUsage(
  db: ReturnType<typeof getAdminDb>,
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number },
  cost: number
) {
  const today = new Date().toISOString().split("T")[0];
  const ref = db.collection("usageMetrics").doc(today);

  await ref.set(
    {
      date: today,
      queryCount: FieldValue.increment(1),
      inputTokens: FieldValue.increment(usage.input_tokens),
      cacheCreationTokens: FieldValue.increment(usage.cache_creation_input_tokens),
      cacheReadTokens: FieldValue.increment(usage.cache_read_input_tokens),
      outputTokens: FieldValue.increment(usage.output_tokens),
      estimatedCost: FieldValue.increment(cost),
    },
    { merge: true }
  );
}
