import { DocumentCategory } from "@/types";

// Token estimation: ~1 token per 4 characters
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// Category detection based on filename and content keywords
export function detectCategory(
  filename: string,
  content: string
): DocumentCategory {
  const lower = (filename + " " + content.slice(0, 500)).toLowerCase();

  if (
    lower.includes("handbook") ||
    lower.includes("vacation") ||
    lower.includes("leave") ||
    lower.includes("benefits") ||
    lower.includes("onboarding") ||
    lower.includes("hr ") ||
    lower.includes("human resources")
  ) {
    return "hr";
  }

  if (
    lower.includes("engineering") ||
    lower.includes("technical") ||
    lower.includes("architecture") ||
    lower.includes("deployment") ||
    lower.includes("development") ||
    lower.includes("api ") ||
    lower.includes("code")
  ) {
    return "engineering";
  }

  if (
    lower.includes("policy") ||
    lower.includes("procedure") ||
    lower.includes("compliance") ||
    lower.includes("security") ||
    lower.includes("gdpr") ||
    lower.includes("regulation")
  ) {
    return "policy";
  }

  if (
    lower.includes("finance") ||
    lower.includes("budget") ||
    lower.includes("expense") ||
    lower.includes("invoice") ||
    lower.includes("reimburs") ||
    lower.includes("payroll")
  ) {
    return "finance";
  }

  if (
    lower.includes("legal") ||
    lower.includes("contract") ||
    lower.includes("agreement") ||
    lower.includes("nda") ||
    lower.includes("terms") ||
    lower.includes("liability")
  ) {
    return "legal";
  }

  return "general";
}

// Priority calculation: higher = more important
export function calculatePriority(
  filename: string,
  category: DocumentCategory
): number {
  const lower = filename.toLowerCase();

  if (lower.includes("handbook")) return 100;
  if (lower.includes("policy") || lower.includes("policies")) return 90;
  if (lower.includes("faq") || lower.includes("frequently")) return 85;
  if (lower.includes("onboarding") || lower.includes("getting-started"))
    return 80;
  if (lower.includes("procedure") || lower.includes("process")) return 75;

  // Category-based defaults
  const categoryDefaults: Record<DocumentCategory, number> = {
    hr: 70,
    policy: 65,
    legal: 65,
    finance: 60,
    engineering: 55,
    general: 50,
  };

  return categoryDefaults[category];
}

// Parse PDF using pdf-parse
export async function parsePDF(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid issues in edge runtime
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text.trim();
}

// Parse DOCX using mammoth
export async function parseDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

export interface ParsedDocument {
  content: string;
  tokenCount: number;
  category: DocumentCategory;
  priority: number;
}

export async function parseFile(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const ext = filename.toLowerCase().split(".").pop();
  let content = "";

  if (ext === "pdf") {
    content = await parsePDF(buffer);
    if (!content || content.length < 50) {
      // No text layer detected — fall back to Gemini Vision OCR
      const { extractTextWithOCR } = await import("@/lib/pdf-ocr");
      content = await extractTextWithOCR(buffer);
    }
  } else if (ext === "docx" || ext === "doc") {
    content = await parseDOCX(buffer);
  } else if (ext === "txt" || ext === "md") {
    content = buffer.toString("utf-8").trim();
  } else {
    throw new Error(`Unsupported file type: .${ext}`);
  }

  if (!content) {
    // Scanned / image-only files — save with a placeholder so the file is
    // marked as synced and won't be retried on every subsequent sync run.
    content = `[Файл "${filename}" не містить тексту для розпізнавання. Можливо, це відскановане зображення або захищений PDF.]`;
  }

  const category = detectCategory(filename, content);
  const priority = calculatePriority(filename, category);
  const tokenCount = estimateTokenCount(content);

  return { content, tokenCount, category, priority };
}
