import Anthropic from "@anthropic-ai/sdk";
import { SelectedDocument } from "@/lib/document-selector";
import { TokenUsage } from "@/types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an internal AI assistant for company employees. Your role is to answer questions based ONLY on the company documents provided to you.

Rules:
1. Answer ONLY using information from the provided documents
2. If the answer is not in the documents, say: "I don't have information about that in the company documents. Please contact HR/your manager for this question."
3. Always cite the document(s) you used by name at the end of your answer
4. Be concise and helpful
5. Never make up information or use external knowledge for factual company-specific questions
6. For general knowledge questions unrelated to company specifics (e.g., "what is Python?"), you may answer normally

Format citations as: **Sources: [Document Name 1], [Document Name 2]**`;

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
  const match = text.match(/\*\*Sources?:\s*([^*]+)\*\*/i);
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
          text: `<company_documents>\n${documentContext}\n</company_documents>\n\nPlease use only these documents to answer my questions.`,
          cache_control: { type: "ephemeral" },
        },
      ],
    },
    {
      role: "assistant",
      content:
        "Understood. I'll answer your questions using only the provided company documents.",
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
