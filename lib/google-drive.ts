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
  "application/vnd.google-apps.spreadsheet": "txt",
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

export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();

  const mimeTypeFilter = SUPPORTED_MIME_TYPES.map(
    (mime) => `mimeType='${mime}'`
  ).join(" or ");

  const response = await drive.files.list({
    q: `'${folderId}' in parents and (${mimeTypeFilter}) and trashed=false`,
    fields: "files(id, name, mimeType, modifiedTime, size)",
    pageSize: 1000,
    orderBy: "name",
  });

  return (response.data.files ?? []) as DriveFile[];
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
    { fileId, alt: "media" },
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
