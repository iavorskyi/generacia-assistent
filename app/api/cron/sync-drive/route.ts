/**
 * GET /api/cron/sync-drive
 *
 * Scheduled daily by Vercel Cron (vercel.json).
 * Responsibilities:
 *  1. Renew the Drive push-notification channel if it expires within 48 hours.
 *  2. Run a full folder sync as a safety fallback (catches any missed notifications).
 *
 * Auth: Bearer {CRON_SECRET} (same secret used by /api/cron/refresh-websites).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getDriveClient } from "@/lib/google-drive";
import { runDriveSync, saveSyncResult } from "@/lib/drive-sync";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

export const maxDuration = 120;

const RENEW_BEFORE_MS = 48 * 60 * 60 * 1000; // renew if < 48h remaining

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("sync-drive cron: CRON_SECRET is not set");
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const drive = getDriveClient();
  const report: Record<string, unknown> = {};

  // ── 1. Channel renewal ────────────────────────────────────────────────────
  const webhookSecret = process.env.DRIVE_WEBHOOK_SECRET;
  const appUrl = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");

  if (!webhookSecret || !appUrl) {
    report.channelRenewal = "skipped — DRIVE_WEBHOOK_SECRET or NEXTAUTH_URL not set";
  } else {
    try {
      const settingsDoc = await db.collection("settings").doc("driveSync").get();
      const data = settingsDoc.exists ? settingsDoc.data()! : {};
      const channelExpiry: number = data.channelExpiry ?? 0;
      const timeLeft = channelExpiry - Date.now();

      if (timeLeft > RENEW_BEFORE_MS) {
        report.channelRenewal = `ok — expires in ${Math.round(timeLeft / 3_600_000)}h`;
      } else {
        // Stop old channel
        if (data.channelId && data.resourceId) {
          try {
            await drive.channels.stop({
              requestBody: { id: data.channelId, resourceId: data.resourceId },
            });
          } catch {
            // Non-fatal — channel may have already expired
          }
        }

        // Get fresh start page token
        const tokenRes = await drive.changes.getStartPageToken({
          supportsAllDrives: true,
        });
        const startPageToken = tokenRes.data.startPageToken!;

        // Register new channel
        const channelId = randomUUID();
        const expirationMs = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days
        const watchRes = await drive.changes.watch({
          pageToken: startPageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          requestBody: {
            id: channelId,
            type: "web_hook",
            address: `${appUrl}/api/webhooks/drive`,
            token: webhookSecret,
            expiration: String(expirationMs),
          },
        });

        const resourceId = watchRes.data.resourceId!;
        const actualExpiry = Number(watchRes.data.expiration ?? expirationMs);

        await db
          .collection("settings")
          .doc("driveSync")
          .set(
            {
              channelId,
              resourceId,
              channelExpiry: actualExpiry,
              startPageToken,
              channelRegisteredAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

        report.channelRenewal = `renewed — new expiry: ${new Date(actualExpiry).toISOString()}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("sync-drive cron: channel renewal failed:", msg);
      report.channelRenewal = `error: ${msg}`;
    }
  }

  // ── 2. Full sync (fallback) ───────────────────────────────────────────────
  try {
    const result = await runDriveSync();
    await saveSyncResult(result);
    report.sync = result;
    console.log(
      `sync-drive cron: done — added=${result.added} updated=${result.updated} errors=${result.errors.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sync-drive cron: sync failed:", msg);
    report.sync = { error: msg };
  }

  return NextResponse.json(report);
}
