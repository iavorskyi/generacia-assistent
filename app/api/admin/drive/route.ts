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

export const maxDuration = 300;

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

// GET /api/admin/drive — preview files with sync status
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

// POST /api/admin/drive — execute sync
export async function POST() {
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

  const result = {
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: [] as string[],
  };

  try {
    const files = await listFilesInFolder(folderId);
    const db = getAdminDb();

    // Process sequentially to avoid memory spikes from parallel large file downloads
    for (const file of files) {
      try {
        const existing = await getExistingDocByDriveId(file.id);

        if (existing && existing.driveModifiedTime === file.modifiedTime) {
          result.unchanged++;
          continue;
        }

        const buffer = await downloadFileAsBuffer(file.id, file.mimeType);
        const filename = normalizeFilename(file);
        const parsed = await parseFile(buffer, filename);

        if (existing) {
          await db.collection("documents").doc(existing.id).update({
            filename,
            content: parsed.content,
            category: parsed.category,
            priority: parsed.priority,
            tokenCount: parsed.tokenCount,
            driveModifiedTime: file.modifiedTime,
            // Preserve: uploadedBy, uploadedAt, usageCount, lastUsed
          });
          result.updated++;
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
            driveFileId: file.id,
            driveModifiedTime: file.modifiedTime,
          });
          result.added++;
        }
      } catch (fileError) {
        const msg =
          fileError instanceof Error ? fileError.message : "Unknown error";
        result.errors.push(`${file.name}: ${msg}`);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Drive sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
