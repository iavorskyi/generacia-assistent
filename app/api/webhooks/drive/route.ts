/**
 * POST /api/webhooks/drive
 *
 * Receives Google Drive push notifications (drive.changes.watch).
 * Google sends a POST when any file visible to the service account changes.
 *
 * Security:
 *   - Verified via X-Goog-Channel-Token header = DRIVE_WEBHOOK_SECRET env var
 *
 * Throttling:
 *   - If last sync ran < 5 minutes ago, returns 200 immediately to avoid
 *     hammering the Drive API on rapid consecutive changes.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { runDriveSync, saveSyncResult } from "@/lib/drive-sync";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

export const maxDuration = 60; // Drive sync can take 30-60s with many files

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

  // 3. Throttle: deduplicate rapid burst notifications (e.g. bulk upload).
  //    If within the throttle window, mark syncPending=true so the next
  //    notification (or cron) picks up the change — never silently drop it.
  try {
    const settingsDoc = await db.collection("settings").doc("driveSync").get();
    if (settingsDoc.exists) {
      const lastSyncAt = settingsDoc.data()?.lastSyncAt as Timestamp | undefined;
      const syncPending = settingsDoc.data()?.syncPending as boolean | undefined;

      if (lastSyncAt && !syncPending) {
        const msSinceLast = Date.now() - lastSyncAt.toMillis();
        if (msSinceLast < THROTTLE_MS) {
          console.log(
            `drive-webhook: throttled (${Math.round(msSinceLast / 1000)}s since last sync) — marking syncPending`
          );
          // Mark pending so the next webhook or cron will run the sync
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

  // 4. Run full folder sync
  console.log("drive-webhook: running sync triggered by Drive notification");
  try {
    const result = await runDriveSync();
    await saveSyncResult(result);
    // Clear pending flag now that sync completed
    await db.collection("settings").doc("driveSync").set(
      { syncPending: false },
      { merge: true }
    );
    console.log(
      `drive-webhook: done — added=${result.added} updated=${result.updated} errors=${result.errors.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("drive-webhook: sync failed:", msg);
    // Store the error in Firestore so it's visible in the admin UI
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
