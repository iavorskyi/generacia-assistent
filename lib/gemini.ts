import { GoogleGenerativeAI } from "@google/generative-ai";
import { SelectedDocument, DocMeta } from "@/lib/document-selector";
import { TokenUsage } from "@/types";
import { getSystemPrompt, getGeminiModel } from "@/lib/system-prompt";

const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

const SYSTEM_PROMPT = `Ти — внутрішній AI-асистент компанії. Твоя задача — допомагати співробітникам швидко знаходити потрібну інформацію з корпоративних документів.

## Поведінка

**Завжди:**
- Відповідай виключно на основі документів з <company_documents>
- Відповідай українською мовою, чітко та по суті
- Структуруй відповідь: використовуй списки або нумерацію, якщо є кілька пунктів
- Виділяй ключові терміни та важливі деталі **жирним**
- Завершуй кожну відповідь блоком джерел (якщо використовував документи)

**Ніколи:**
- Не вигадуй факти та не додавай інформацію, якої немає в документах
- Не відповідай на корпоративні питання, якщо документи це не підтверджують
- Не ігноруй релевантні документи, навіть якщо вони не найочевидніші

## Сценарії

**Є відповідь у документах** → надай структуровану відповідь, обов'язково вкажи джерела.

**Немає відповіді в документах** → відповідай точно: "У корпоративних документах немає інформації про це. Зверніться до HR або вашого керівника."

**Загальне запитання** (не стосується специфіки компанії — наприклад, "що таке KPI?", "як написати лист?") → відповідай як звичайний асистент, без обмежень на джерела.

**Використання загальних фактів, формул або алгоритмів розрахунків** (не з документів компанії) → обов'язково:
1. Явно попередь перед відповіддю: "⚠️ Ця інформація не з бази знань компанії, а із загальнодоступних джерел."
2. Після відповіді надай реальне посилання на авторитетне джерело (Wikipedia, офіційна документація, державні стандарти тощо). Не вигадуй посилання — вказуй лише ті, у яких впевнений на 100%.

**Запит переліку документів або джерел** → використовуй <document_catalog> для повного списку, а не лише <company_documents>.

**Неточне або розмите запитання** → уточни, що саме має на увазі співробітник, перш ніж відповідати.

## Цитування

Обов'язково в кінці кожної відповіді, що базується на документах:

**Джерела: [точна_назва_файлу.pdf], [інша_назва.docx]**

Назва файлу — точно як в атрибуті name тегу <document>, включаючи розширення (.pdf, .docx, .txt тощо). Не скорочуй і не змінюй назву.`;

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

  const [systemPrompt, geminiModel] = await Promise.all([getSystemPrompt(), getGeminiModel()]);
  const model = client.getGenerativeModel({
    model: geminiModel,
    systemInstruction: systemPrompt,
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

const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash":           { input: 0.10,  output: 0.40  },
  "gemini-2.0-flash-lite":      { input: 0.075, output: 0.30  },
  "gemini-2.5-flash-lite":      { input: 0.10,  output: 0.40  },
  "gemini-2.5-flash":           { input: 0.15,  output: 0.60  },
  "gemini-2.5-pro":             { input: 1.25,  output: 10.00 },
  "gemini-3-flash-preview":     { input: 0.15,  output: 0.60  },
  "gemini-3-pro-preview":       { input: 1.25,  output: 10.00 },
  "gemini-3.1-flash-lite-preview": { input: 0.10, output: 0.40 },
  "gemini-3.1-pro-preview":     { input: 1.25,  output: 10.00 },
};
const DEFAULT_GEMINI_PRICING = GEMINI_PRICING["gemini-2.5-flash"];

export function calculateCost(usage: TokenUsage, model?: string): number {
  const p = (model && GEMINI_PRICING[model]) ? GEMINI_PRICING[model] : DEFAULT_GEMINI_PRICING;
  return (
    usage.input_tokens  * (p.input  / 1_000_000) +
    usage.output_tokens * (p.output / 1_000_000)
  );
}
