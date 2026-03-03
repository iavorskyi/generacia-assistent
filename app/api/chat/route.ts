import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { selectDocuments } from "@/lib/document-selector";
import { chatWithCachedContext, calculateCost as calculateCostClaude, ChatMessage } from "@/lib/claude";
import { chatWithContext as chatWithGemini, calculateCost as calculateCostGemini } from "@/lib/gemini";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Необхідна автентифікація" }, { status: 401 });
  }

  const { query, conversationId } = await request.json();

  if (!query?.trim()) {
    return NextResponse.json({ error: "Запит обов'язковий" }, { status: 400 });
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
        return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
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
  const { documents, allDocumentNames, fromCache } = await selectDocuments(
    query,
    convRef.id === conversationId ? conversationId : null
  );

  if (documents.length === 0) {
    return NextResponse.json(
      {
        error:
          "Документи недоступні. Попросіть адміністратора завантажити документи компанії.",
      },
      { status: 404 }
    );
  }

  // Read active AI provider from Firestore settings
  const settingsDoc = await db.collection("settings").doc("ai").get();
  const provider = (settingsDoc.data()?.provider as "claude" | "gemini") ?? "claude";

  // Call the active AI provider
  const result = provider === "gemini"
    ? await chatWithGemini(query, documents, allDocumentNames, conversationHistory)
    : await chatWithCachedContext(query, documents, allDocumentNames, conversationHistory);

  const cost = provider === "gemini"
    ? calculateCostGemini(result.usage)
    : calculateCostClaude(result.usage);

  // Match citation names back to document IDs for the UI to open sources
  type CitationMeta = { id: string; filename: string; driveFileId: string | null; sourceUrl: string | null; notionPageId: string | null };
  const citationMeta: CitationMeta[] = result.citations
    .map((citName) => {
      const doc = documents.find((d) => {
        const a = d.filename.toLowerCase();
        const b = citName.toLowerCase();
        return a === b || a.includes(b) || b.includes(a.replace(/\.[^.]+$/, ""));
      });
      if (!doc) return null;
      const d = doc as typeof doc & { driveFileId?: string; sourceUrl?: string; notionPageId?: string };
      // Use citName (what the AI wrote) as the key so the UI can match it to citations[]
      return { id: doc.id, filename: citName, driveFileId: d.driveFileId ?? null, sourceUrl: d.sourceUrl ?? null, notionPageId: d.notionPageId ?? null };
    })
    .filter((m): m is CitationMeta => m !== null);

  // Build updated conversation
  const newMessages: ChatMessage[] = [
    ...conversationHistory,
    { role: "user", content: query },
    { role: "assistant", content: result.answer },
  ];

  // Calculate cache expiry (5 minutes from now)
  const cacheValidUntil = new Date(Date.now() + 5 * 60 * 1000);

  // Build conversation data - only include cache fields when not from cache
  const conversationData: Record<string, unknown> = {
    userId: session.user.id,
    messages: newMessages.slice(-20), // keep last 20 messages
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  };

  if (!fromCache) {
    conversationData.cachedDocumentIds = documents.map((d) => d.id);
    conversationData.cacheValidUntil = cacheValidUntil;
  }

  // Save conversation
  await convRef.set(conversationData, { merge: true });

  // Track usage metrics (fire and forget)
  trackUsage(db, result.usage, cost).catch(console.error);

  return NextResponse.json({
    answer: result.answer,
    citations: result.citations,
    citationMeta,
    conversationId: convRef.id,
    cacheStatus: result.cacheStatus,
    fromCache,
    documentsUsed: documents.length,
    usage: result.usage,
    cost,
    provider,
  });
  } catch (error) {
    console.error("Chat API error:", error);

    // Translate known API errors into friendly Ukrainian messages
    if (error instanceof Error) {
      const msg = error.message;

      // Gemini quota / billing errors (429)
      if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("quota")) {
        return NextResponse.json(
          {
            error:
              "Gemini API: вичерпано ліміт запитів або не підключено білінг. " +
              "Перейдіть на https://aistudio.google.com та увімкніть білінг для вашого проєкту, " +
              "або переключіться на Claude в адмін-панелі (Налаштування → Claude Haiku).",
          },
          { status: 429 }
        );
      }

      // Gemini auth errors (403)
      if (msg.includes("403") || msg.includes("API key") || msg.includes("permission")) {
        return NextResponse.json(
          { error: "Gemini API: невірний або відсутній API-ключ. Перевірте GEMINI_API_KEY." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Внутрішня помилка сервера" },
      { status: 500 }
    );
  }
}

async function trackUsage(
  db: ReturnType<typeof getAdminDb>,
  usage: { input_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens: number },
  cost: number
) {
  const today = new Date().toISOString().split("T")[0];
  const ref = db.collection("usageMetrics").doc(today);

  await ref.set(
    {
      date: today,
      queryCount: FieldValue.increment(1),
      inputTokens: FieldValue.increment(usage.input_tokens),
      cacheCreationTokens: FieldValue.increment(usage.cache_creation_input_tokens ?? 0),
      cacheReadTokens: FieldValue.increment(usage.cache_read_input_tokens ?? 0),
      outputTokens: FieldValue.increment(usage.output_tokens),
      estimatedCost: FieldValue.increment(cost),
    },
    { merge: true }
  );
}
