/**
 * Shared Google Drive sync logic.
 *
 * Used by:
 *  - POST /api/admin/drive     (manual single-file sync)
 *  - POST /api/webhooks/drive  (automatic push-notification sync)
 *  - GET  /api/cron/sync-drive (scheduled renewal + fallback sync)
 */
import { getAdminDb } from "@/lib/firebase-admin";
import { parseFile } from "@/lib/parsers";
import {
  needsChunking,
  createChunks,
  saveChunks,
  deleteChunks,
} from "@/lib/chunker";
import {
  listFilesInFolder,
  downloadFileAsBuffer,
  normalizeFilename,
  DriveFile,
} from "@/lib/google-drive";
import { FieldValue } from "firebase-admin/firestore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

export interface DriveSyncStatus {
  channelId: string;
  resourceId: string;
  channelExpiry: number;   // Unix timestamp ms
  lastSyncAt: string | null;
  lastSyncResult: SyncResult | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 900_000;

export async function getExistingDocByDriveId(
  driveFileId: string
): Promise<{ id: string; driveModifiedTime?: string; chunkIds?: string[] } | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection("documents")
    .where("driveFileId", "==", driveFileId)
    .get();

  if (snapshot.empty) return null;

  // Skip chunk docs — only the parent carries driveFileId at root level.
  const parent = snapshot.docs.find((d) => !d.data().isChunk);
  if (!parent) return null;

  return {
    id: parent.id,
    driveModifiedTime: parent.data().driveModifiedTime,
    chunkIds: parent.data().chunkIds ?? [],
  };
}

// ─── Single-file sync ─────────────────────────────────────────────────────────

/**
 * Sync one Drive file into Firestore.
 * Returns "added" | "updated" | "unchanged".
 */
export async function syncDriveFile(
  file: DriveFile
): Promise<"added" | "updated" | "unchanged"> {
  const db = getAdminDb();
  const existing = await getExistingDocByDriveId(file.id);

  if (existing && existing.driveModifiedTime === file.modifiedTime) {
    return "unchanged";
  }

  const buffer = await downloadFileAsBuffer(file.id, file.mimeType);
  const filename = normalizeFilename(file);
  const parsed = await parseFile(buffer, filename);

  const rawContent = parsed.content;
  const driveSourceUrl = `https://drive.google.com/file/d/${file.id}/view`;
  const shouldChunk = needsChunking(rawContent);

  let content = rawContent;
  let truncated = false;

  if (shouldChunk) {
    content =
      rawContent.slice(0, 1_000) +
      `\n\n[Документ розбито на частини для ефективного пошуку]`;
  } else if (Buffer.byteLength(rawContent, "utf8") > MAX_CONTENT_BYTES) {
    content = Buffer.from(rawContent, "utf8")
      .slice(0, MAX_CONTENT_BYTES)
      .toString("utf8");
    content += "\n\n[Вміст обрізано через обмеження розміру]";
    truncated = true;
  }

  const tokenCount = truncated
    ? Math.round(MAX_CONTENT_BYTES / 4)
    : parsed.tokenCount;

  const chunkMeta = {
    filename,
    category: parsed.category,
    priority: parsed.priority,
    sourceType: "drive",
    sourceUrl: driveSourceUrl,
  };

  if (existing) {
    if (existing.chunkIds?.length) {
      await deleteChunks(existing.chunkIds);
    }

    await db.collection("documents").doc(existing.id).update({
      filename,
      content,
      category: parsed.category,
      priority: parsed.priority,
      tokenCount,
      truncated,
      isChunked: shouldChunk || null,
      chunkIds: [],
      chunkCount: 0,
      driveFileId: file.id,
      sourceUrl: driveSourceUrl,
      driveModifiedTime: file.modifiedTime,
      lastFetched: FieldValue.serverTimestamp(),
    });

    if (shouldChunk) {
      const chunks = createChunks(rawContent);
      const chunkIds = await saveChunks(existing.id, chunks, chunkMeta);
      await db
        .collection("documents")
        .doc(existing.id)
        .update({ chunkIds, chunkCount: chunkIds.length });
    }

    return "updated";
  } else {
    const docRef = await db.collection("documents").add({
      filename,
      content,
      category: parsed.category,
      priority: parsed.priority,
      tokenCount,
      truncated,
      isChunked: shouldChunk || null,
      chunkIds: [],
      chunkCount: 0,
      uploadedBy: "drive-sync",
      uploadedAt: FieldValue.serverTimestamp(),
      usageCount: 0,
      lastUsed: null,
      sourceType: "drive",
      driveFileId: file.id,
      sourceUrl: driveSourceUrl,
      driveModifiedTime: file.modifiedTime,
      lastFetched: FieldValue.serverTimestamp(),
    });

    if (shouldChunk) {
      const chunks = createChunks(rawContent);
      const chunkIds = await saveChunks(docRef.id, chunks, chunkMeta);
      await docRef.update({ chunkIds, chunkCount: chunkIds.length });
    }

    return "added";
  }
}

// ─── Full folder sync ─────────────────────────────────────────────────────────

/**
 * List all files in the configured Drive folder and sync any that are
 * new or modified since last sync. Unchanged files are skipped.
 *
 * Returns a summary of the sync operation.
 */
export async function runDriveSync(): Promise<SyncResult> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured");
  }

  const files = await listFilesInFolder(folderId);
  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, errors: [] };

  for (const file of files) {
    try {
      const status = await syncDriveFile(file);
      if (status === "added") result.added++;
      else if (status === "updated") result.updated++;
      else result.unchanged++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`drive-sync: error syncing ${file.name}:`, msg);
      result.errors.push(`${file.name}: ${msg}`);
    }
  }

  return result;
}

// ─── Persist sync result ──────────────────────────────────────────────────────

export async function saveSyncResult(result: SyncResult): Promise<void> {
  const db = getAdminDb();
  await db
    .collection("settings")
    .doc("driveSync")
    .set(
      {
        lastSyncAt: FieldValue.serverTimestamp(),
        lastSyncResult: {
          added: result.added,
          updated: result.updated,
          unchanged: result.unchanged,
          // Cap stored errors to avoid hitting Firestore document limits
          errors: result.errors.slice(0, 20),
        },
      },
      { merge: true }
    );
}
