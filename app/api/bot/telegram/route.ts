import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { selectDocuments } from "@/lib/document-selector";
import { chatWithCachedContext, ChatMessage } from "@/lib/claude";
import { chatWithContext as chatWithGemini } from "@/lib/gemini";
import { calculateCost as calculateCostClaude } from "@/lib/claude";
import { calculateCost as calculateCostGemini } from "@/lib/gemini";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 60;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
// Env var fallback (comma-separated). Firestore list takes priority when set.
const ALLOWED_USERS_ENV = process.env.TELEGRAM_ALLOWED_USERS
  ? process.env.TELEGRAM_ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

async function getAllowedUsers(): Promise<string[]> {
  try {
    const db = getAdminDb();
    const doc = await db.collection("settings").doc("telegram").get();
    const firestoreList: string[] = doc.data()?.allowedUsers ?? [];
    // If Firestore list exists (even empty array means "open to all"),
    // use it; otherwise fall back to env var.
    if (doc.exists) return firestoreList;
  } catch {
    // Firestore unavailable — fall back to env var
  }
  return ALLOWED_USERS_ENV;
}

// ── Telegram API helpers ──────────────────────────────────────────────────────

async function sendMessage(chatId: number, text: string) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    // Try with Markdown first; fall back to plain text if Telegram rejects the formatting
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[TG] sendMessage failed (${res.status}):`, JSON.stringify(err));
      // Retry without parse_mode (plain text)
      const res2 = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      if (!res2.ok) {
        const err2 = await res2.json().catch(() => ({}));
        console.error(`[TG] sendMessage plain also failed (${res2.status}):`, JSON.stringify(err2));
      }
    }
  }
}

async function sendTyping(chatId: number) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

// Telegram Markdown: convert **bold** → *bold*, strip leftover ** marks
function formatForTelegram(text: string): string {
  // Replace **Джерела: ...** with a cleaner footer
  let formatted = text.replace(
    /\*\*(?:Sources?|Джерела?):\s*([^*]+)\*\*/gi,
    (_, sources) => `\n\n📎 *Джерела:* ${sources.trim()}`
  );

  // Convert remaining **word** → *word* (Telegram bold)
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Escape special chars that break Telegram Markdown (only outside * spans)
  // Keep it simple: just remove underscores from bold spans
  return formatted.trim();
}

// Split message into ≤4096 char chunks at paragraph boundaries
function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    // Find last paragraph break before limit
    let splitAt = remaining.lastIndexOf("\n\n", limit);
    if (splitAt < 100) splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < 100) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function trackUsage(
  db: ReturnType<typeof getAdminDb>,
  usage: { input_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens: number },
  cost: number
) {
  const today = new Date().toISOString().split("T")[0];
  await db.collection("usageMetrics").doc(today).set(
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

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Validate webhook secret
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.message) {
    return NextResponse.json({ ok: true });
  }

  // Await fully — Vercel kills execution on return, so fire-and-forget doesn't work.
  // Telegram webhook waits up to 60s; our maxDuration matches.
  await handleMessage(body.message).catch(console.error);

  return NextResponse.json({ ok: true });
}

async function handleMessage(message: {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string };
  text?: string;
}) {
  const chatId = message.chat.id;
  const telegramUserId = message.from?.id;
  const text = (message.text ?? "").trim();

  if (!text) return;

  // 2. Access control — load list from Firestore (editable via admin UI)
  const allowedUsers = await getAllowedUsers();
  if (allowedUsers.length > 0 && telegramUserId) {
    const allowed =
      allowedUsers.includes(String(telegramUserId)) ||
      (message.from?.username && allowedUsers.includes(`@${message.from.username}`));
    if (!allowed) {
      await sendMessage(chatId, "Вибачте, у вас немає доступу до цього бота. Зверніться до адміністратора.");
      return;
    }
  }

  const db = getAdminDb();
  const convRef = db.collection("telegramChats").doc(String(chatId));

  // 3. Handle commands
  if (text.startsWith("/")) {
    const command = text.split(" ")[0].toLowerCase();

    if (command === "/start") {
      await sendMessage(
        chatId,
        `👋 *Вітаю!* Я — внутрішній асистент компанії.\n\n` +
        `Я відповідаю на питання на основі документів компанії.\n\n` +
        `*Команди:*\n` +
        `/new — Почати нову розмову\n` +
        `/help — Допомога\n\n` +
        `Просто напишіть своє питання!`
      );
      return;
    }

    if (command === "/help") {
      await sendMessage(
        chatId,
        `*Як користуватися ботом:*\n\n` +
        `• Запитайте будь-що про процедури, політики або документацію компанії\n` +
        `• Бот відповідає лише на основі офіційних документів\n` +
        `• Джерела вказуються внизу кожної відповіді\n\n` +
        `*Команди:*\n` +
        `/new — Очистити історію розмови\n` +
        `/help — Показати цю довідку`
      );
      return;
    }

    if (command === "/new") {
      await convRef.set({ messages: [], updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await sendMessage(chatId, "✅ Розмову розпочато заново.");
      return;
    }

    // Unknown command — treat as regular message
  }

  // 4. Show typing indicator
  await sendTyping(chatId);

  try {
    // 5. Load conversation history
    const convDoc = await convRef.get();
    const conversationHistory: ChatMessage[] = convDoc.data()?.messages ?? [];

    // 6. Select documents
    const { documents, allDocumentNames, fromCache } = await selectDocuments(
      text,
      String(chatId)
    );

    if (documents.length === 0) {
      await sendMessage(chatId, "Документи компанії недоступні. Зверніться до адміністратора.");
      return;
    }

    // 7. Read active AI provider
    const settingsDoc = await db.collection("settings").doc("ai").get();
    const provider = (settingsDoc.data()?.provider as "claude" | "gemini") ?? "claude";

    // 8. Call AI
    const result =
      provider === "gemini"
        ? await chatWithGemini(text, documents, allDocumentNames, conversationHistory)
        : await chatWithCachedContext(text, documents, allDocumentNames, conversationHistory);

    const cost =
      provider === "gemini"
        ? calculateCostGemini(result.usage)
        : calculateCostClaude(result.usage);

    // 9. Format and send response
    const formatted = formatForTelegram(result.answer);
    await sendMessage(chatId, formatted);

    // 10. Save updated conversation
    const newMessages: ChatMessage[] = [
      ...conversationHistory,
      { role: "user" as const, content: text },
      { role: "assistant" as const, content: result.answer },
    ].slice(-20);

    const updateData: Record<string, unknown> = {
      telegramUserId: telegramUserId ?? null,
      messages: newMessages,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!fromCache) {
      updateData.cachedDocumentIds = documents.map((d) => d.id);
      updateData.cacheValidUntil = new Date(Date.now() + 5 * 60 * 1000);
    }
    await convRef.set(updateData, { merge: true });

    // 11. Track usage metrics
    trackUsage(db, result.usage, cost).catch(console.error);
  } catch (error) {
    console.error("Telegram bot error:", error);
    const errMsg = error instanceof Error ? error.message : "Невідома помилка";

    let userMsg = "Вибачте, виникла помилка. Спробуйте ще раз.";
    if (errMsg.includes("quota") || errMsg.includes("429")) {
      userMsg = "Вибачте, перевищено ліміт запитів до AI. Спробуйте за кілька хвилин.";
    }
    await sendMessage(chatId, userMsg);
  }
}
