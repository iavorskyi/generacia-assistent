import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { DriveFile, getDriveClient, listFilesInFolder } from "@/lib/google-drive";
import {
  getExistingDocByDriveId,
  syncDriveFile,
  runDriveSync,
  saveSyncResult,
} from "@/lib/drive-sync";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

export const maxDuration = 120; // 120s — allows time for Gemini OCR on scanned PDFs

function getFolderId(): string | null {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  return id || null;
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
    const db = getAdminDb();

    const [files, syncSettingsDoc] = await Promise.all([
      listFilesInFolder(folderId),
      db.collection("settings").doc("driveSync").get(),
    ]);

    const syncSettings = syncSettingsDoc.exists ? syncSettingsDoc.data()! : null;

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
      autoSync: syncSettings
        ? {
            channelId: syncSettings.channelId ?? null,
            channelExpiry: syncSettings.channelExpiry ?? null,
            lastSyncAt: syncSettings.lastSyncAt?.toDate?.()?.toISOString() ?? null,
            lastSyncResult: syncSettings.lastSyncResult ?? null,
            lastWebhookAt: syncSettings.lastWebhookAt?.toDate?.()?.toISOString() ?? null,
            syncPending: syncSettings.syncPending ?? false,
            lastWebhookError: syncSettings.lastWebhookError ?? null,
            lastWebhookErrorAt: syncSettings.lastWebhookErrorAt?.toDate?.()?.toISOString() ?? null,
          }
        : null,
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
    const existing = await getExistingDocByDriveId(fileId);
    if (existing && existing.driveModifiedTime === modifiedTime) {
      return NextResponse.json({ status: "unchanged" });
    }

    const file: DriveFile = { id: fileId, name, mimeType, modifiedTime, size: "" };
    const result = await syncDriveFile(file);
    return NextResponse.json({ status: result });
  } catch (error) {
    console.error("Drive sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/admin/drive — register (or renew) the Drive push-notification channel
export async function PUT() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const webhookSecret = process.env.DRIVE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "DRIVE_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  // DRIVE_WEBHOOK_URL lets you pin the webhook to a verified domain (e.g. the
  // production URL) even when deploying to a preview/dev environment whose
  // alias is not registered in Google Cloud's domain verification list.
  // Falls back to NEXTAUTH_URL if not set.
  const appUrl = (
    process.env.DRIVE_WEBHOOK_URL ?? process.env.NEXTAUTH_URL ?? ""
  ).replace(/\/$/, "");
  if (!appUrl) {
    return NextResponse.json(
      { error: "DRIVE_WEBHOOK_URL (or NEXTAUTH_URL) is not configured" },
      { status: 500 }
    );
  }

  try {
    const db = getAdminDb();
    const drive = getDriveClient();

    // Stop existing channel if present
    const existing = await db.collection("settings").doc("driveSync").get();
    if (existing.exists) {
      const data = existing.data()!;
      if (data.channelId && data.resourceId) {
        try {
          await drive.channels.stop({
            requestBody: { id: data.channelId, resourceId: data.resourceId },
          });
        } catch {
          // Non-fatal — channel may have already expired
        }
      }
    }

    // Detect whether the folder lives in a Shared Drive (Team Drive).
    // For Shared Drives, drive.changes.watch() and getStartPageToken() require
    // a driveId parameter — without it they default to the service account's
    // My Drive, which won't see changes to Shared Drive files.
    const folderId = getFolderId()!;
    let sharedDriveId: string | undefined;
    try {
      const folderMeta = await drive.files.get({
        fileId: folderId,
        supportsAllDrives: true,
        fields: "driveId",
      });
      sharedDriveId = folderMeta.data.driveId ?? undefined;
      if (sharedDriveId) {
        console.log("drive-channel: Shared Drive detected, driveId:", sharedDriveId);
      }
    } catch (e) {
      console.warn("drive-channel: could not detect driveId:", e);
    }

    // Get current change page token for the correct scope
    const tokenRes = await drive.changes.getStartPageToken({
      supportsAllDrives: true,
      ...(sharedDriveId ? { driveId: sharedDriveId } : {}),
    });
    const startPageToken = tokenRes.data.startPageToken!;

    // Register new watch channel (max 7 days; Drive caps the expiration)
    const channelId = randomUUID();
    const expirationMs = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days
    const watchRes = await drive.changes.watch({
      pageToken: startPageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(sharedDriveId ? { driveId: sharedDriveId } : {}),
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
          sharedDriveId: sharedDriveId ?? null,
          channelRegisteredAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // Run an immediate full sync so any files that existed before the channel
    // was registered (or changed while it was inactive) get picked up right away.
    // drive.changes.watch() only notifies about changes *after* startPageToken,
    // so without this initial sync pre-existing new/updated files would be missed.
    let initialSync = null;
    try {
      const syncResult = await runDriveSync();
      await saveSyncResult(syncResult);
      initialSync = syncResult;
    } catch (syncErr) {
      console.error("Drive channel: initial sync failed:", syncErr);
      // Non-fatal — channel is registered, sync will retry via cron or next webhook
    }

    return NextResponse.json({
      channelId,
      resourceId,
      channelExpiry: actualExpiry,
      expiresAt: new Date(actualExpiry).toISOString(),
      initialSync,
    });
  } catch (error) {
    console.error("Drive channel registration error:", error);
    const message = error instanceof Error ? error.message : "Registration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
