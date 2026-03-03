import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseFile } from "@/lib/parsers";
import {
  listFilesInFolder,
  downloadFileAsBuffer,
  normalizeFilename,
  DriveFile,
} from "@/lib/google-drive";
import { FieldValue } from "firebase-admin/firestore";

export const maxDuration = 60;

function getFolderId(): string | null {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  return id || null;
}

async function getExistingDocByDriveId(
  driveFileId: string
): Promise<{ id: string; driveModifiedTime?: string } | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection("documents")
    .where("driveFileId", "==", driveFileId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    driveModifiedTime: doc.data().driveModifiedTime,
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
    if (!fileId || !name || !mimeType || !modifiedTime) {
      return NextResponse.json(
        { error: "fileId, name, mimeType and modifiedTime are required" },
        { status: 400 }
      );
    }
  } catch {
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

    if (existing) {
      await db.collection("documents").doc(existing.id).update({
        filename,
        content: parsed.content,
        category: parsed.category,
        priority: parsed.priority,
        tokenCount: parsed.tokenCount,
        driveModifiedTime: modifiedTime,
        lastFetched: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ status: "updated" });
    } else {
      await db.collection("documents").add({
        filename,
        content: parsed.content,
        category: parsed.category,
        priority: parsed.priority,
        tokenCount: parsed.tokenCount,
        uploadedBy: "drive-sync",
        uploadedAt: FieldValue.serverTimestamp(),
        usageCount: 0,
        lastUsed: null,
        sourceType: "drive",
        driveFileId: fileId,
        driveModifiedTime: modifiedTime,
        lastFetched: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ status: "added" });
    }
  } catch (error) {
    console.error("Drive sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
