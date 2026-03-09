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
    lower.includes("payroll") ||
    // Ukrainian: price list, warehouse, stock, cost, quantity, supplier, order
    lower.includes("прайс") ||
    lower.includes("ціна") ||
    lower.includes("вартість") ||
    lower.includes("склад") ||
    lower.includes("наявніст") ||
    lower.includes("залишок") ||
    lower.includes("кількість") ||
    lower.includes("постачальник") ||
    lower.includes("замовлення") ||
    lower.includes("товар") ||
    lower.includes("продукт") ||
    lower.includes("партія")
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

  // Ukrainian / national normative documents: ПУЕ, ДБН, ДСТУ, НПАОП, etc.
  if (
    lower.includes("пуе") ||
    lower.includes("pue") ||
    lower.includes("дбн") ||
    lower.includes("дсту") ||
    lower.includes("нпаоп") ||
    lower.includes("правила улаштування") ||
    lower.includes("будівельні норми") ||
    lower.includes("державний стандарт") ||
    lower.includes("технічний регламент") ||
    lower.includes("норми та правила")
  ) {
    return "regulations";
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
  // Ukrainian: price list and stock files are operationally critical
  if (lower.includes("прайс") || lower.includes("прайслист")) return 85;
  if (lower.includes("склад") || lower.includes("залишок") || lower.includes("наявніст")) return 80;
  // Ukrainian normative docs — high baseline so they beat generic technical manuals
  if (lower.includes("пуе") || lower.includes("pue")) return 85;
  if (lower.includes("дбн") || lower.includes("дсту") || lower.includes("нпаоп")) return 80;

  // Category-based defaults
  const categoryDefaults: Record<DocumentCategory, number> = {
    hr: 70,
    policy: 65,
    regulations: 65,  // normative docs are important reference material
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

// Parse CSV / Excel (.xlsx, .xls) using SheetJS — converts to markdown tables
export async function parseSpreadsheet(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const XLSX = await import("xlsx");
  const MAX_ROWS_PER_SHEET = 2000;

  const isCsv = filename.toLowerCase().endsWith(".csv");
  const workbook = isCsv
    ? XLSX.read(buffer.toString("utf-8"), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });

  const sections: string[] = [];
  const sheetCount = workbook.SheetNames.length;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false, // return formatted values (dates as strings, not serial numbers)
      defval: "",
      blankrows: false,
    });

    // Skip entirely empty sheets
    const nonEmptyRows = rows.filter((row) =>
      row.some((cell) => String(cell).trim() !== "")
    );
    if (nonEmptyRows.length === 0) continue;

    const sectionParts: string[] = [];
    if (sheetCount > 1) sectionParts.push(`## Sheet: "${sheetName}"\n`);

    const headerRow = nonEmptyRows[0];
    const dataRows = nonEmptyRows.slice(1);
    const totalDataRows = dataRows.length;
    const cappedDataRows = dataRows.slice(0, MAX_ROWS_PER_SHEET);

    // Detect columns that are completely empty across ALL data rows and drop them.
    // This removes placeholder columns (e.g. "Стовпець 11–14" with 0 values)
    // that waste tokens without providing any information.
    const colCount = (headerRow as unknown[]).length;
    const usedCols = new Set<number>();
    // Always keep columns that have a non-empty header
    (headerRow as unknown[]).forEach((h, i) => {
      if (String(h ?? "").trim() !== "") usedCols.add(i);
    });
    // Mark a column as "used" if any data row has a value in it
    for (const row of cappedDataRows) {
      (row as unknown[]).forEach((cell, i) => {
        if (String(cell ?? "").trim() !== "") usedCols.add(i);
      });
    }
    // Build the ordered list of column indices to keep
    const keepCols = Array.from({ length: colCount }, (_, i) => i).filter((i) =>
      usedCols.has(i)
    );

    // Escape pipe characters and inline newlines so markdown table stays valid
    const escape = (cell: unknown) =>
      String(cell ?? "")
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ");

    const pickCols = (row: unknown[]) =>
      keepCols.map((i) => escape((row as unknown[])[i] ?? ""));

    sectionParts.push(`| ${pickCols(headerRow as unknown[]).join(" | ")} |`);
    sectionParts.push(`| ${keepCols.map(() => "---").join(" | ")} |`);
    cappedDataRows.forEach((row) =>
      sectionParts.push(`| ${pickCols(row as unknown[]).join(" | ")} |`)
    );

    if (totalDataRows > MAX_ROWS_PER_SHEET) {
      sectionParts.push(
        `\n[Table truncated: showing ${MAX_ROWS_PER_SHEET} of ${totalDataRows} rows]`
      );
    }

    sections.push(sectionParts.join("\n"));
  }

  return sections.join("\n\n");
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
  } else if (ext === "csv" || ext === "xlsx" || ext === "xls") {
    content = await parseSpreadsheet(buffer, filename);
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
