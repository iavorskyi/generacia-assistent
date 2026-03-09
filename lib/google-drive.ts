import { google } from "googleapis";

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  // Google Workspace native types (exported on download)
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  // Excel files (downloaded directly as binary)
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
];

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/vnd.google-apps.document": "docx",
  "application/vnd.google-apps.spreadsheet": "csv", // exported as CSV by Drive
  // Excel files
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

// Google Workspace files must be exported (not downloaded directly)
const GOOGLE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
}

function getDriveClient() {
  const auth = new google.auth.JWT({
    email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    key: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

/** Returns true if `id` looks like a Shared Drive (starts with "0A"). */
function isSharedDriveId(id: string): boolean {
  return id.startsWith("0A");
}

/**
 * Recursively lists all supported files under a folder (or Shared Drive root).
 * Works for both regular My Drive folders and Shared Drives.
 *
 * Optimisations vs the naive sequential BFS:
 *  1. Single API call per folder (fetches files + subfolders together, filters locally)
 *     → ~2× fewer round-trips
 *  2. All folders at the same depth are fetched in parallel
 *     → depth × latency instead of (total folders) × latency
 */
export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();
  const sharedDrive = isSharedDriveId(folderId);
  const supportedMimeSet = new Set(SUPPORTED_MIME_TYPES);

  const allFiles: DriveFile[] = [];
  const visitedFolders = new Set<string>([folderId]);

  /** Fetch all children of one folder; returns subfolder ids found. */
  async function processFolder(currentFolder: string): Promise<string[]> {
    const subfolderIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${currentFolder}' in parents and trashed=false`,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...(sharedDrive ? { driveId: folderId, corpora: "drive" } : {}),
        ...(pageToken ? { pageToken } : {}),
      });

      for (const file of response.data.files ?? []) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          if (file.id) subfolderIds.push(file.id);
        } else if (file.mimeType && supportedMimeSet.has(file.mimeType)) {
          allFiles.push(file as DriveFile);
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return subfolderIds;
  }

  // BFS level-by-level, processing each level fully in parallel.
  let currentLevel = [folderId];

  while (currentLevel.length > 0) {
    const results = await Promise.all(currentLevel.map(processFolder));
    const nextLevel: string[] = [];

    for (const subfolderIds of results) {
      for (const id of subfolderIds) {
        if (!visitedFolders.has(id)) {
          visitedFolders.add(id);
          nextLevel.push(id);
        }
      }
    }

    currentLevel = nextLevel;
  }

  return allFiles;
}

export async function downloadFileAsBuffer(
  fileId: string,
  mimeType?: string
): Promise<Buffer> {
  const drive = getDriveClient();

  const exportMime = mimeType ? GOOGLE_EXPORT_MIME[mimeType] : undefined;

  if (exportMime) {
    // Google Workspace files must be exported
    const response = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  const response = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );

  return Buffer.from(response.data as ArrayBuffer);
}

// Ensures filename has the correct extension for parseFile() dispatch.
// Drive files sometimes omit extensions (e.g. "Employee Handbook" instead of "Employee Handbook.pdf").
export function normalizeFilename(file: DriveFile): string {
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(file.name);
  if (hasExt) return file.name;

  const ext = MIME_TO_EXT[file.mimeType];
  return ext ? `${file.name}.${ext}` : file.name;
}
