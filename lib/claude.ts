import Anthropic from "@anthropic-ai/sdk";
import { SelectedDocument, DocMeta } from "@/lib/document-selector";
import { TokenUsage } from "@/types";
import { getSystemPrompt } from "@/lib/system-prompt";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
  return allDocs
    .map((d) => `- ${d.filename} (${d.category})`)
    .join("\n");
}

function formatDocumentsForContext(documents: SelectedDocument[]): string {
  return documents
    .map((doc) => {
      // For chunk documents, add a chunk attribute so Claude knows it's a partial view
      const chunkAttr = doc.isChunk && doc.totalChunks
        ? ` chunk="${(doc.chunkIndex ?? 0) + 1}/${doc.totalChunks}"`
        : "";
      return `<document name="${doc.filename}" category="${doc.category}" priority="${doc.priority}"${chunkAttr}>
${doc.content}
</document>`;
    })
    .join("\n\n");
}

function extractCitations(text: string): string[] {
  // Match both English "Sources" and Ukrainian "Джерела"
  const match = text.match(/\*\*(?:Sources?|Джерела?):\s*([^*]+)\*\*/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function chatWithCachedContext(
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

  // Build messages with cache_control on the document context
  const messages: Anthropic.MessageParam[] = [
    // First message: cached document context + catalog
    {
      role: "user",
      content: [
        {
          type: "text",
          text: contextText,
          cache_control: { type: "ephemeral" },
        },
      ],
    },
    {
      role: "assistant",
      content:
        "Зрозуміло. Я відповідатиму на ваші питання, використовуючи лише надані документи компанії.",
    },
    // Include conversation history (last 8 exchanges = 16 messages)
    ...conversationHistory.slice(-16).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    // Current question
    {
      role: "user",
      content: query,
    },
  ];

  const systemPrompt = await getSystemPrompt();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  });

  const answer =
    response.content[0].type === "text" ? response.content[0].text : "";
  const citations = extractCitations(answer);

  const usage = response.usage as unknown as {
    input_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens: number;
  };

  const cacheRead = (usage.cache_read_input_tokens ?? 0) > 0;
  const cacheCreated = (usage.cache_creation_input_tokens ?? 0) > 0;

  return {
    answer,
    citations,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
    cacheStatus: cacheRead ? "hit" : cacheCreated ? "created" : "miss",
  };
}

// Calculate cost in USD based on token usage
export function calculateCost(usage: TokenUsage): number {
  // Claude Sonnet 4.6 pricing (per 1M tokens)
  const INPUT_COST = 3.0 / 1_000_000;
  const CACHE_WRITE_COST = 3.75 / 1_000_000;
  const CACHE_READ_COST = 0.3 / 1_000_000;
  const OUTPUT_COST = 15.0 / 1_000_000;

  return (
    usage.input_tokens * INPUT_COST +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_COST +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ_COST +
    usage.output_tokens * OUTPUT_COST
  );
}
