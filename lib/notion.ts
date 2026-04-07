import { GoogleGenerativeAI } from "@google/generative-ai";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function describeImageWithGemini(
  imageUrl: string,
  caption: string
): Promise<string> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];

    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
    const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = caption
      ? `Опиши детально, що зображено на цьому зображенні. Підпис до зображення: "${caption}". Відповідай українською мовою.`
      : "Опиши детально, що зображено на цьому зображенні. Відповідай українською мовою.";

    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64 } },
      prompt,
    ]);

    return result.response.text().trim();
  } catch (err) {
    console.error("Notion image description failed:", err);
    return "";
  }
}

function getNotionToken(): string {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not configured");
  return token;
}

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getNotionToken()}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export interface NotionPage {
  id: string;
  title: string;
  lastEdited: string;
  url: string;
}

type RichTextItem = { plain_text: string };
type Block = Record<string, unknown>;

function extractRichText(richText: RichTextItem[] | undefined): string {
  return (richText ?? []).map((t) => t.plain_text).join("");
}

function extractPageTitle(page: Block): string {
  const props = page.properties as Record<string, Block> | undefined;
  if (!props) return "(Без назви)";

  // First pass: find the title-type property
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      const titleArr = prop.title as RichTextItem[] | undefined;
      if (titleArr && titleArr.length > 0) {
        const text = titleArr.map((t) => t.plain_text).join("").trim();
        if (text) return text;
      }
    }
  }

  // Fallback: use the first non-empty readable property (for empty DB rows)
  for (const prop of Object.values(props)) {
    const type = prop.type as string;
    let fallback = "";
    if (type === "rich_text") {
      fallback = extractRichText(prop.rich_text as RichTextItem[] | undefined).trim();
    } else if (type === "select") {
      fallback = ((prop.select as Block | null)?.name as string | undefined) ?? "";
    } else if (type === "status") {
      fallback = ((prop.status as Block | null)?.name as string | undefined) ?? "";
    } else if (type === "date") {
      fallback = ((prop.date as Block | null)?.start as string | undefined) ?? "";
    } else if (type === "people") {
      const people = prop.people as Block[] | undefined;
      fallback = (people ?? []).map((u) => u.name as string).filter(Boolean).join(", ");
    }
    if (fallback.trim()) return fallback.trim();
  }

  // Last resort: show short ID so the row is at least identifiable
  const id = (page.id as string | undefined) ?? "";
  return `(Без назви ${id.slice(0, 8)})`;
}

export async function listNotionPages(): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filter: { value: "page", property: "object" },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`${NOTION_API_BASE}/search`, {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(
        (err as { message?: string }).message ?? `Notion API error: ${res.status}`
      );
    }

    const data = await res.json() as {
      results: Block[];
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const result of data.results) {
      if (result.object !== "page") continue;
      pages.push({
        id: (result.id as string).replace(/-/g, ""),
        title: extractPageTitle(result),
        lastEdited: result.last_edited_time as string,
        url: result.url as string,
      });
    }

    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

async function fetchAllBlocks(blockId: string): Promise<Block[]> {
  const blocks: Block[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);

    const res = await fetch(
      `${NOTION_API_BASE}/blocks/${blockId}/children?${params}`,
      { headers: notionHeaders() }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(
        (err as { message?: string }).message ??
          `Failed to fetch blocks: ${res.status}`
      );
    }

    const data = await res.json() as {
      results: Block[];
      has_more: boolean;
      next_cursor: string | null;
    };

    blocks.push(...data.results);
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return blocks;
}

async function renderBlocks(blocks: Block[]): Promise<string> {
  const parts: string[] = [];
  for (const block of blocks) {
    const rendered = await renderBlock(block);
    if (rendered !== null) parts.push(rendered);
  }
  return parts.join("\n\n");
}

async function renderBlock(block: Block): Promise<string | null> {
  const type = block.type as string;
  const content = block[type] as Block | undefined;
  if (!content) return null;

  const richText = content.rich_text as RichTextItem[] | undefined;
  const text = extractRichText(richText);

  let result: string | null = null;

  switch (type) {
    case "paragraph":
      result = text;
      break;
    case "heading_1":
      result = `# ${text}`;
      break;
    case "heading_2":
      result = `## ${text}`;
      break;
    case "heading_3":
      result = `### ${text}`;
      break;
    case "bulleted_list_item":
      result = `- ${text}`;
      break;
    case "numbered_list_item":
      result = `1. ${text}`;
      break;
    case "to_do": {
      const checked = content.checked ? "[x]" : "[ ]";
      result = `- ${checked} ${text}`;
      break;
    }
    case "toggle":
      result = text;
      break;
    case "quote":
    case "callout":
      result = `> ${text}`;
      break;
    case "code": {
      const lang = (content.language as string) || "";
      result = `\`\`\`${lang}\n${text}\n\`\`\``;
      break;
    }
    case "divider":
      result = "---";
      break;
    case "image": {
      const caption = extractRichText(content.caption as RichTextItem[] | undefined);
      const fileObj = content.file as { url?: string } | undefined;
      const externalObj = content.external as { url?: string } | undefined;
      const imageUrl = fileObj?.url ?? externalObj?.url ?? "";

      if (imageUrl && process.env.GEMINI_API_KEY) {
        const description = await describeImageWithGemini(imageUrl, caption);
        if (description) {
          result = caption
            ? `[Зображення: ${caption}\nОпис: ${description}]`
            : `[Зображення\nОпис: ${description}]`;
          break;
        }
      }
      // Fallback if no API key or description failed
      result = caption ? `[Зображення: ${caption}]` : "[Зображення]";
      break;
    }
    case "table": {
      if (block.has_children) {
        const rows = await fetchAllBlocks(block.id as string);
        const tableLines: string[] = [];
        rows.forEach((row, idx) => {
          const cells = (
            (row.table_row as Block | undefined)?.cells as
              | RichTextItem[][]
              | undefined
          );
          if (!cells) return;
          const rowText = cells.map((cell) => extractRichText(cell)).join(" | ");
          tableLines.push(`| ${rowText} |`);
          if (idx === 0) {
            tableLines.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
        });
        result = tableLines.join("\n");
      }
      break;
    }
    case "column_list":
    case "column":
    case "table_of_contents":
      result = null;
      break;
    default:
      result = null;
  }

  // Recurse into children (toggles, columns, etc.) — skip table rows (handled above)
  if (block.has_children && !["table", "table_row"].includes(type)) {
    const children = await fetchAllBlocks(block.id as string);
    const childMarkdown = await renderBlocks(children);
    if (childMarkdown.trim()) {
      result = result ? `${result}\n\n${childMarkdown}` : childMarkdown;
    }
  }

  return result;
}

async function fetchPagePropertiesAsMarkdown(pageId: string): Promise<string> {
  const res = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    headers: notionHeaders(),
  });
  if (!res.ok) return "";

  const page = await res.json() as Block;
  const props = page.properties as Record<string, Block> | undefined;
  if (!props) return "";

  const lines: string[] = [];

  for (const [key, prop] of Object.entries(props)) {
    const type = prop.type as string;
    let value = "";

    switch (type) {
      case "title":
        // Skip — already used as the document filename
        continue;
      case "rich_text":
        value = extractRichText(prop.rich_text as RichTextItem[] | undefined);
        break;
      case "select": {
        const s = prop.select as Block | null;
        value = (s?.name as string) ?? "";
        break;
      }
      case "multi_select":
        value = ((prop.multi_select as Block[]) ?? [])
          .map((s) => s.name as string)
          .filter(Boolean)
          .join(", ");
        break;
      case "status": {
        const s = prop.status as Block | null;
        value = (s?.name as string) ?? "";
        break;
      }
      case "date": {
        const d = prop.date as Block | null;
        value = d ? `${d.start ?? ""}${d.end ? ` → ${d.end}` : ""}` : "";
        break;
      }
      case "number":
        value = prop.number != null ? String(prop.number) : "";
        break;
      case "checkbox":
        value = prop.checkbox ? "так" : "ні";
        break;
      case "url":
        value = (prop.url as string) ?? "";
        break;
      case "email":
        value = (prop.email as string) ?? "";
        break;
      case "phone_number":
        value = (prop.phone_number as string) ?? "";
        break;
      case "people":
        value = ((prop.people as Block[]) ?? [])
          .map((u) => u.name as string)
          .filter(Boolean)
          .join(", ");
        break;
      case "files":
        value = ((prop.files as Block[]) ?? [])
          .map((f) => {
            const name = f.name as string | undefined;
            const url =
              (f.file as Block | undefined)?.url ??
              (f.external as Block | undefined)?.url ?? "";
            return name ? `${name}${url ? ` (${url})` : ""}` : (url as string);
          })
          .filter(Boolean)
          .join(", ");
        break;
      default:
        continue;
    }

    if (value.trim()) {
      lines.push(`**${key}:** ${value.trim()}`);
    }
  }

  return lines.join("\n\n");
}

export async function fetchPageAsMarkdown(pageId: string): Promise<string> {
  const [propertiesMarkdown, blocksMarkdown] = await Promise.all([
    fetchPagePropertiesAsMarkdown(pageId),
    fetchAllBlocks(pageId).then(renderBlocks),
  ]);

  return [propertiesMarkdown, blocksMarkdown]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}
