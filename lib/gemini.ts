import { GoogleGenerativeAI } from "@google/generative-ai";
import { SelectedDocument, DocMeta } from "@/lib/document-selector";
import { TokenUsage } from "@/types";

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

const SYSTEM_PROMPT = `Ти — внутрішній AI-асистент для працівників компанії. Твоя роль — відповідати на питання ЛИШЕ на основі наданих документів компанії.

Правила:
1. Відповідай ТІЛЬКИ використовуючи інформацію з наданих документів
2. Якщо відповіді немає в документах, скажи: "У документах компанії немає інформації про це. Будь ласка, зверніться до HR або вашого керівника."
3. Завжди вказуй ТОЧНУ назву файлу документа(ів) в кінці відповіді — ТОЧНО як написано в атрибуті name тегу <document>, включаючи розширення (.pdf, .docx тощо)
4. Будь лаконічним та корисним
5. Ніколи не вигадуй інформацію та не використовуй зовнішні знання для питань, специфічних для компанії
6. Для загальних питань, не пов'язаних зі специфікою компанії (наприклад, "що таке Python?"), можеш відповідати звичайно
7. Якщо запитують про список всіх документів або джерел — перелічуй файли з <document_catalog>, а не тільки ті, що є у <company_documents>

Формат цитування: **Джерела: [точна_назва_файлу.pdf], [інша_назва.docx]**`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  answer: string;
  citations: string[];
  usage: TokenUsage;
  cacheStatus: "hit" | "miss" | "created";
}

function formatDocumentCatalog(allDocs: DocMeta[]): string {
  return allDocs.map((d) => `- ${d.filename} (${d.category})`).join("\n");
}

function formatDocumentsForContext(documents: SelectedDocument[]): string {
  return documents
    .map(
      (doc) =>
        `<document name="${doc.filename}" category="${doc.category}" priority="${doc.priority}">
${doc.content}
</document>`
    )
    .join("\n\n");
}

function extractCitations(text: string): string[] {
  const match = text.match(/\*\*(?:Sources?|Джерела?):\s*([^*]+)\*\*/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function chatWithContext(
  query: string,
  documents: SelectedDocument[],
  allDocumentNames: DocMeta[],
  conversationHistory: ChatMessage[]
): Promise<ChatResult> {
  const catalog = formatDocumentCatalog(allDocumentNames);
  const documentContext = formatDocumentsForContext(documents);

  const contextText =
    `<document_catalog>\n` +
    `Повний список усіх документів у базі знань (${allDocumentNames.length} файлів):\n` +
    `${catalog}\n` +
    `</document_catalog>\n\n` +
    `<company_documents>\n` +
    `${documentContext}\n` +
    `</company_documents>\n\n` +
    `Будь ласка, використовуй лише ці документи для відповіді на мої питання. ` +
    `Якщо питання стосується переліку всіх джерел — використовуй <document_catalog>.`;

  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  // Build Gemini history: first turn is context, then conversation history
  // Gemini uses "model" instead of "assistant"
  const history = [
    {
      role: "user" as const,
      parts: [{ text: contextText }],
    },
    {
      role: "model" as const,
      parts: [{ text: "Зрозуміло. Я відповідатиму на ваші питання, використовуючи лише надані документи компанії." }],
    },
    ...conversationHistory.slice(-16).map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      parts: [{ text: m.content }],
    })),
  ];

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(query);
  const answer = result.response.text();
  const citations = extractCitations(answer);

  const usageMeta = result.response.usageMetadata;
  const inputTokens = usageMeta?.promptTokenCount ?? 0;
  const outputTokens = usageMeta?.candidatesTokenCount ?? 0;

  return {
    answer,
    citations,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    cacheStatus: "miss",
  };
}

export function calculateCost(usage: TokenUsage): number {
  // Gemini 2.5 Flash pricing (per 1M tokens, non-thinking mode)
  const INPUT_COST = 0.15 / 1_000_000;
  const OUTPUT_COST = 0.60 / 1_000_000;

  return (
    usage.input_tokens * INPUT_COST +
    usage.output_tokens * OUTPUT_COST
  );
}
