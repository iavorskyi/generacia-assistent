import { GoogleGenerativeAI } from "@google/generative-ai";

// Minimum character count to consider a PDF as having a text layer
const MIN_TEXT_LENGTH = 50;

export function hasTextLayer(text: string): boolean {
  return text.trim().length >= MIN_TEXT_LENGTH;
}

export async function extractTextWithOCR(pdfBuffer: Buffer): Promise<string> {
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "application/pdf",
        data: pdfBuffer.toString("base64"),
      },
    },
    "Extract ALL text from this PDF document exactly as it appears. Preserve the original structure: headings, lists, tables, paragraphs. Return only the extracted text — no commentary, no explanations.",
  ]);

  return result.response.text().trim();
}
