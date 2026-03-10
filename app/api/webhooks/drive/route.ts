/**
 * POST /api/webhooks/drive
 *
 * Receives Google Drive push notifications (drive.changes.watch).
 * Google sends a POST when any file visible to the service account changes.
 *
 * Security:
 *   - Verified via X-Goog-Channel-Token header = DRIVE_WEBHOOK_SECRET env var
 *
 * Sync strategy:
 *   - Uses drive.changes.list() with stored startPageToken to get ONLY the files
 *     that changed, with their authoritative metadata from Drive's change log.
 *     This avoids the Drive files.list() timing issue where the API may return
 *     stale modifiedTime immediately after a change notification is delivered.
 *   - Falls back to runDriveSync() (full folder scan) if no startPageToken stored.
 *
 * Throttling:
 *   - If last sync ran < 30s ago, returns 200 but marks syncPending=true.
 *   - The next notification will pick up all pending changes via the page token.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getDriveClient } from "@/lib/google-drive";
import { runDriveSync, saveSyncResult, syncDriveFile, SyncResult } from "@/lib/drive-sync";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

export const maxDuration = 60; // Drive sync can take up to 60s

const THROTTLE_MS = 30 * 1000; // 30 seconds — deduplicate rapid bursts only

export async function POST(req: NextRequest) {
  // 1. Verify the channel token
  const channelToken = req.headers.get("x-goog-channel-token");
  const expectedToken = process.env.DRIVE_WEBHOOK_SECRET;

  if (!expectedToken) {
    console.error("drive-webhook: DRIVE_WEBHOOK_SECRET is not configured");
    return new NextResponse(null, { status: 500 });
  }

  if (channelToken !== expectedToken) {
    console.warn("drive-webhook: invalid channel token");
    return new NextResponse(null, { status: 401 });
  }

  // 2. Stamp lastWebhookAt for ALL requests (including the initial "sync" ping)
  //    so the admin UI can confirm Drive is reaching this endpoint.
  const syncType = req.headers.get("x-goog-resource-state");
  const db = getAdminDb();
  try {
    await db.collection("settings").doc("driveSync").set(
      { lastWebhookAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error("drive-webhook: failed to stamp lastWebhookAt:", err);
  }

  // Acknowledge the initial handshake ping and exit — no sync needed.
  if (syncType === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  // 3. Read settings once: throttle check + startPageToken + sharedDriveId.
  let startPageToken: string | undefined;
  let sharedDriveId: string | undefined;
  try {
    const settingsDoc = await db.collection("settings").doc("driveSync").get();
    if (settingsDoc.exists) {
      const data = settingsDoc.data()!;
      startPageToken = data.startPageToken as string | undefined;
      sharedDriveId = data.sharedDriveId as string | undefined;

      const lastSyncAt = data.lastSyncAt as Timestamp | undefined;
      const syncPending = data.syncPending as boolean | undefined;

      if (lastSyncAt && !syncPending) {
        const msSinceLast = Date.now() - lastSyncAt.toMillis();
        if (msSinceLast < THROTTLE_MS) {
          console.log(
            `drive-webhook: throttled (${Math.round(msSinceLast / 1000)}s since last sync) — marking syncPending`
          );
          // Mark pending; the next notification will process all changes via page token
          await db.collection("settings").doc("driveSync").set(
            { syncPending: true },
            { merge: true }
          );
          return new NextResponse(null, { status: 200 });
        }
      }
    }
  } catch (err) {
    console.error("drive-webhook: failed to read settings:", err);
    // Non-fatal; proceed with sync
  }

  // 4. Sync: use drive.changes.list() for targeted sync (much faster than a full
  //    folder scan and avoids Drive files.list() caching — the changes feed returns
  //    authoritative, up-to-date file metadata for each changed file).
  //    Falls back to runDriveSync() if no startPageToken stored yet.
  console.log("drive-webhook: running targeted sync via changes.list()");
  try {
    let result: SyncResult;

    if (!startPageToken) {
      // No page token stored — fall back to full folder scan
      console.log("drive-webhook: no startPageToken, running full sync fallback");
      result = await runDriveSync();
    } else {
      result = await syncChangesFromPageToken(startPageToken, sharedDriveId);
    }

    await saveSyncResult(result);
    await db.collection("settings").doc("driveSync").set(
      { syncPending: false },
      { merge: true }
    );
    console.log(
      `drive-webhook: done — added=${result.added} updated=${result.updated} unchanged=${result.unchanged} errors=${result.errors.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("drive-webhook: sync failed:", msg);
    try {
      await db.collection("settings").doc("driveSync").set(
        { lastWebhookError: msg, lastWebhookErrorAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch { /* non-fatal */ }
    // Return 200 so Google doesn't retry and flood us
  }

  return new NextResponse(null, { status: 200 });
}

/**
 * Fetches only the files that changed since `startPageToken` using Drive's
 * changes feed. The feed includes current file metadata in each change entry,
 * so there are no timing/caching issues with modifiedTime.
 *
 * Persists the new startPageToken to Firestore before syncing, so even if sync
 * fails we don't reprocess the same changes on the next notification.
 *
 * For Shared Drives (Team Drives), `sharedDriveId` must be passed so the
 * changes.list() call queries the correct changes feed (not My Drive).
 */
async function syncChangesFromPageToken(
  startPageToken: string,
  sharedDriveId?: string
): Promise<SyncResult> {
  const drive = getDriveClient();
  const db = getAdminDb();
  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, errors: [] };

  let pageToken: string = startPageToken;
  let newPageToken: string = startPageToken;

  // Collect all changed (non-removed, non-trashed, non-folder) files
  const changedFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    size: string;
  }> = [];

  while (true) {
    const res = await drive.changes.list({
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(sharedDriveId ? { driveId: sharedDriveId } : {}),
      fields:
        "nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, size, trashed))",
    });

    for (const change of res.data.changes ?? []) {
      if (
        !change.removed &&
        change.file &&
        !change.file.trashed &&
        change.fileId &&
        change.file.id &&
        change.file.mimeType !== "application/vnd.google-apps.folder"
      ) {
        changedFiles.push({
          id: change.file.id,
          name: change.file.name ?? change.fileId,
          mimeType: change.file.mimeType ?? "application/octet-stream",
          modifiedTime: change.file.modifiedTime ?? "",
          size: change.file.size ?? "",
        });
      }
    }

    if (res.data.newStartPageToken) {
      newPageToken = res.data.newStartPageToken;
    }

    if (!res.data.nextPageToken) break;
    pageToken = res.data.nextPageToken;
  }

  // Persist the new page token immediately so we don't reprocess old changes
  // even if the sync below fails partway through.
  await db
    .collection("settings")
    .doc("driveSync")
    .set({ startPageToken: newPageToken }, { merge: true });

  if (changedFiles.length === 0) {
    console.log("drive-webhook: changes.list() returned no file changes");
    return result;
  }

  console.log(`drive-webhook: ${changedFiles.length} file(s) in changes feed — syncing`);

  // Sync each changed file using the metadata from the changes feed.
  // syncDriveFile() compares file.modifiedTime against the stored driveModifiedTime;
  // since this value comes from Drive's authoritative changes feed, it's always current.
  for (const file of changedFiles) {
    try {
      const status = await syncDriveFile(file);
      if (status === "added") result.added++;
      else if (status === "updated") result.updated++;
      else result.unchanged++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`drive-webhook: error syncing ${file.name}:`, msg);
      result.errors.push(`${file.name}: ${msg}`);
    }
  }

  return result;
}
