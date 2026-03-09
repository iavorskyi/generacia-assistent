import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseFile } from "@/lib/parsers";
import { needsChunking, createChunks, saveChunks } from "@/lib/chunker";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 120; // 120s — allows time for Gemini OCR on scanned PDFs

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB limit per file
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseFile(buffer, file.name);

    const rawContent  = parsed.content;
    const shouldChunk = needsChunking(rawContent);

    // For chunked docs: store a short excerpt in the parent; full content in chunks.
    const content = shouldChunk
      ? rawContent.slice(0, 1_000) + `\n\n[Документ розбито на частини для ефективного пошуку]`
      : rawContent;

    const db = getAdminDb();
    const docRef = await db.collection("documents").add({
      filename:   file.name,
      content,
      category:   parsed.category,
      priority:   parsed.priority,
      tokenCount: parsed.tokenCount,
      isChunked:  shouldChunk || null,
      chunkIds:   [],
      chunkCount: 0,
      uploadedBy: session.user.id,
      uploadedAt: FieldValue.serverTimestamp(),
      usageCount: 0,
      lastUsed:   null,
    });

    if (shouldChunk) {
      const chunks   = createChunks(rawContent);
      const chunkIds = await saveChunks(docRef.id, chunks, {
        filename:   file.name,
        category:   parsed.category,
        priority:   parsed.priority,
        sourceType: "upload",
      });
      await docRef.update({ chunkIds, chunkCount: chunkIds.length });

      return NextResponse.json({
        success: true,
        documentId: docRef.id,
        filename:   file.name,
        category:   parsed.category,
        priority:   parsed.priority,
        tokenCount: parsed.tokenCount,
        chunked:    true,
        chunkCount: chunkIds.length,
      });
    }

    return NextResponse.json({
      success: true,
      documentId:     docRef.id,
      filename:       file.name,
      category:       parsed.category,
      priority:       parsed.priority,
      tokenCount:     parsed.tokenCount,
      characterCount: rawContent.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
