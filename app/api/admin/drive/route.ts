import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseFile } from "@/lib/parsers";
import { needsChunking, createChunks, saveChunks, deleteChunks } from "@/lib/chunker";
import {
  listFilesInFolder,
  downloadFileAsBuffer,
  normalizeFilename,
  DriveFile,
} from "@/lib/google-drive";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 120; // 120s — allows time for Gemini OCR on scanned PDFs

function getFolderId(): string | null {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  return id || null;
}

async function getExistingDocByDriveId(
  driveFileId: string
): Promise<{ id: string; driveModifiedTime?: string; chunkIds?: string[] } | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection("documents")
    .where("driveFileId", "==", driveFileId)
    .get();

  if (snapshot.empty) return null;

  // Skip chunk docs — older syncs may have written driveFileId onto chunks too.
  // The parent is the doc without isChunk: true.
  const parent = snapshot.docs.find((d) => !d.data().isChunk);
  if (!parent) return null;

  return {
    id:                parent.id,
    driveModifiedTime: parent.data().driveModifiedTime,
    chunkIds:          parent.data().chunkIds ?? [],
  };
}

// GET /api/admin/drive — list files with sync status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const folderId = getFolderId();
  if (!folderId) {
    return NextResponse.json(
      { error: "GOOGLE_DRIVE_FOLDER_ID is not configured" },
      { status: 500 }
    );
  }

  try {
    const files = await listFilesInFolder(folderId);

    const preview = await Promise.all(
      files.map(async (file: DriveFile) => {
        const existing = await getExistingDocByDriveId(file.id);

        let status: "new" | "update" | "unchanged";
        if (!existing) {
          status = "new";
        } else if (existing.driveModifiedTime !== file.modifiedTime) {
          status = "update";
        } else {
          status = "unchanged";
        }

        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          size: file.size,
          status,
        };
      })
    );

    return NextResponse.json({
      folderId,
      fileCount: files.length,
      files: preview,
    });
  } catch (error) {
    console.error("Drive preview error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to list Drive files";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/drive — sync a single file by ID
// Body: { fileId: string; name: string; mimeType: string; modifiedTime: string }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let fileId: string, name: string, mimeType: string, modifiedTime: string;
  try {
    const body = await req.json();
    fileId = body.fileId;
    name = body.name;
    mimeType = body.mimeType;
    modifiedTime = body.modifiedTime;
    if (!fileId || !name || !modifiedTime) {
      return NextResponse.json(
        { error: "fileId, name and modifiedTime are required" },
        { status: 400 }
      );
    }
    mimeType = mimeType || "application/octet-stream";
  } catch (e) {
    console.error("Drive POST parse error:", e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const existing = await getExistingDocByDriveId(fileId);

    if (existing && existing.driveModifiedTime === modifiedTime) {
      return NextResponse.json({ status: "unchanged" });
    }

    const file: DriveFile = { id: fileId, name, mimeType, modifiedTime, size: "" };
    const buffer = await downloadFileAsBuffer(fileId, mimeType);
    const filename = normalizeFilename(file);
    const parsed = await parseFile(buffer, filename);

    const rawContent = parsed.content;
    const driveSourceUrl = `https://drive.google.com/file/d/${fileId}/view`;
    const shouldChunk = needsChunking(rawContent);

    // Prepare parent document content.
    // For chunked docs: store a short excerpt so admin UI can show a preview.
    // Chunks hold the full content — no truncation needed there.
    // For non-chunked docs: apply the legacy 900KB Firestore limit.
    const MAX_CONTENT_BYTES = 900_000;
    let content = rawContent;
    let truncated = false;

    if (shouldChunk) {
      // Keep first 1 000 chars as preview; full content lives in chunks
      content = rawContent.slice(0, 1_000) +
        `\n\n[Документ розбито на частини для ефективного пошуку]`;
    } else if (Buffer.byteLength(rawContent, "utf8") > MAX_CONTENT_BYTES) {
      content = Buffer.from(rawContent, "utf8").slice(0, MAX_CONTENT_BYTES).toString("utf8");
      content += "\n\n[Вміст обрізано через обмеження розміру]";
      truncated = true;
    }

    const tokenCount = truncated
      ? Math.round(MAX_CONTENT_BYTES / 4)
      : parsed.tokenCount;  // full count even for chunked (metadata only)

    const chunkMeta = {
      filename,
      category:    parsed.category,
      priority:    parsed.priority,
      sourceType:  "drive",
      // Note: driveFileId is intentionally NOT stored on chunk docs.
      // Only the parent document carries driveFileId, which keeps
      // getExistingDocByDriveId from accidentally matching a chunk.
      sourceUrl:   driveSourceUrl,
    };

    if (existing) {
      // Delete old chunks before writing new ones
      if (existing.chunkIds?.length) {
        await deleteChunks(existing.chunkIds);
      }

      await db.collection("documents").doc(existing.id).update({
        filename,
        content,
        category:          parsed.category,
        priority:          parsed.priority,
        tokenCount,
        truncated,
        isChunked:         shouldChunk || null,
        chunkIds:          [],          // will be updated below if chunked
        chunkCount:        0,
        driveFileId:       fileId,
        sourceUrl:         driveSourceUrl,
        driveModifiedTime: modifiedTime,
        lastFetched:       FieldValue.serverTimestamp(),
      });

      if (shouldChunk) {
        const chunks   = createChunks(rawContent);
        const chunkIds = await saveChunks(existing.id, chunks, chunkMeta);
        await db.collection("documents").doc(existing.id).update({
          chunkIds,
          chunkCount: chunkIds.length,
        });
        return NextResponse.json({ status: "updated", chunked: true, chunkCount: chunkIds.length });
      }

      return NextResponse.json({ status: "updated", truncated });
    } else {
      const docRef = await db.collection("documents").add({
        filename,
        content,
        category:          parsed.category,
        priority:          parsed.priority,
        tokenCount,
        truncated,
        isChunked:         shouldChunk || null,
        chunkIds:          [],
        chunkCount:        0,
        uploadedBy:        "drive-sync",
        uploadedAt:        FieldValue.serverTimestamp(),
        usageCount:        0,
        lastUsed:          null,
        sourceType:        "drive",
        driveFileId:       fileId,
        sourceUrl:         driveSourceUrl,
        driveModifiedTime: modifiedTime,
        lastFetched:       FieldValue.serverTimestamp(),
      });

      if (shouldChunk) {
        const chunks   = createChunks(rawContent);
        const chunkIds = await saveChunks(docRef.id, chunks, chunkMeta);
        await docRef.update({ chunkIds, chunkCount: chunkIds.length });
        return NextResponse.json({ status: "added", chunked: true, chunkCount: chunkIds.length });
      }

      return NextResponse.json({ status: "added", truncated });
    }
  } catch (error) {
    console.error("Drive sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
