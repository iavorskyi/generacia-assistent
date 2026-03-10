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

const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

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

  // 2. Sync type header — Google sends "sync" for the initial handshake ping,
  //    not an actual file change. Acknowledge it and exit.
  const syncType = req.headers.get("x-goog-resource-state");
  if (syncType === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  // 3. Record that we received a webhook (diagnostic — visible in admin UI)
  //    and throttle if a sync already ran recently.
  const db = getAdminDb();
  try {
    // Always stamp lastWebhookAt so we can confirm Drive is reaching this endpoint
    await db.collection("settings").doc("driveSync").set(
      { lastWebhookAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    const settingsDoc = await db.collection("settings").doc("driveSync").get();
    if (settingsDoc.exists) {
      const lastSyncAt = settingsDoc.data()?.lastSyncAt as Timestamp | undefined;
      if (lastSyncAt) {
        const msSinceLast = Date.now() - lastSyncAt.toMillis();
        if (msSinceLast < THROTTLE_MS) {
          console.log(
            `drive-webhook: throttled — last sync was ${Math.round(msSinceLast / 1000)}s ago`
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
    console.log(
      `drive-webhook: done — added=${result.added} updated=${result.updated} errors=${result.errors.length}`
    );
  } catch (err) {
    console.error("drive-webhook: sync failed:", err);
    // Return 200 so Google doesn't retry and flood us
  }

  return new NextResponse(null, { status: 200 });
}
