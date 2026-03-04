import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseFile } from "@/lib/parsers";
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

    const db = getAdminDb();
    const docRef = await db.collection("documents").add({
      filename: file.name,
      content: parsed.content,
      category: parsed.category,
      priority: parsed.priority,
      tokenCount: parsed.tokenCount,
      uploadedBy: session.user.id,
      uploadedAt: FieldValue.serverTimestamp(),
      usageCount: 0,
      lastUsed: null,
    });

    return NextResponse.json({
      success: true,
      documentId: docRef.id,
      filename: file.name,
      category: parsed.category,
      priority: parsed.priority,
      tokenCount: parsed.tokenCount,
      characterCount: parsed.content.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
