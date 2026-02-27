import Anthropic from "@anthropic-ai/sdk";
import { SelectedDocument } from "@/lib/document-selector";
import { TokenUsage } from "@/types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `Ти — внутрішній AI-асистент для працівників компанії. Твоя роль — відповідати на питання ЛИШЕ на основі наданих документів компанії.

Правила:
1. Відповідай ТІЛЬКИ використовуючи інформацію з наданих документів
2. Якщо відповіді немає в документах, скажи: "У документах компанії немає інформації про це. Будь ласка, зверніться до HR або вашого керівника."
3. Завжди вказуй назву документа(ів), які ти використав, в кінці відповіді
4. Будь лаконічним та корисним
5. Ніколи не вигадуй інформацію та не використовуй зовнішні знання для питань, специфічних для компанії
6. Для загальних питань, не пов'язаних зі специфікою компанії (наприклад, "що таке Python?"), можеш відповідати звичайно

Формат цитування: **Джерела: [Назва документа 1], [Назва документа 2]**`;

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
  conversationHistory: ChatMessage[]
): Promise<ChatResult> {
  const documentContext = formatDocumentsForContext(documents);

  // Build messages with cache_control on the document context
  const messages: Anthropic.MessageParam[] = [
    // First message: cached document context
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `<company_documents>\n${documentContext}\n</company_documents>\n\nБудь ласка, використовуй лише ці документи для відповіді на мої питання.`,
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

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      output_tokens: usage.output_tokens,
    },
    cacheStatus: cacheRead ? "hit" : cacheCreated ? "created" : "miss",
  };
}

// Calculate cost in USD based on token usage
export function calculateCost(usage: TokenUsage): number {
  // Claude Haiku pricing (per 1M tokens)
  const INPUT_COST = 0.25 / 1_000_000;
  const CACHE_WRITE_COST = 0.3 / 1_000_000;
  const CACHE_READ_COST = 0.03 / 1_000_000;
  const OUTPUT_COST = 1.25 / 1_000_000;

  return (
    usage.input_tokens * INPUT_COST +
    usage.cache_creation_input_tokens * CACHE_WRITE_COST +
    usage.cache_read_input_tokens * CACHE_READ_COST +
    usage.output_tokens * OUTPUT_COST
  );
}
