export type DocumentCategory =
  | "hr"
  | "engineering"
  | "policy"
  | "finance"
  | "legal"
  | "regulations"   // Ukrainian/national normative docs: ПУЕ, ДБН, ДСТУ, НПАОП …
  | "general";

export type DocumentSourceType = "file" | "web" | "notion";

export interface Document {
  id: string;
  filename: string;
  content: string;
  category: DocumentCategory;
  priority: number;
  tokenCount: number;
  uploadedBy: string;
  uploadedAt: Date;
  usageCount: number;
  lastUsed?: Date;
  driveFileId?: string;
  driveModifiedTime?: string;
  // Web source fields
  sourceType?: DocumentSourceType;
  sourceUrl?: string;
  lastFetched?: Date;
  fetchError?: string;
  // Notion source fields
  notionPageId?: string;
  notionLastEdited?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  timestamp: Date;
  cacheStatus?: "hit" | "miss" | "created";
}

export interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  cachedDocumentIds?: string[];
  cacheValidUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageMetrics {
  date: string;
  queryCount: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}
