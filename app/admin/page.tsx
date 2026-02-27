"use client";

import { useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface UploadResult {
  filename: string;
  category: string;
  priority: number;
  tokenCount: number;
  documentId: string;
  error?: string;
}

interface DrivePreviewFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
  status: "new" | "update" | "unchanged";
}

interface DrivePreview {
  folderId: string;
  fileCount: number;
  files: DrivePreviewFile[];
}

interface DriveSyncResult {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

export default function AdminUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const [driveSyncing, setDriveSyncing] = useState(false);
  const [drivePreviewLoading, setDrivePreviewLoading] = useState(false);
  const [drivePreview, setDrivePreview] = useState<DrivePreview | null>(null);
  const [driveSyncResult, setDriveSyncResult] = useState<DriveSyncResult | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!session?.user?.isAdmin) {
    router.replace("/");
    return null;
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    const newResults: UploadResult[] = [];

    for (const file of fileArray) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/admin/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok) {
          newResults.push({
            filename: file.name,
            category: "",
            priority: 0,
            tokenCount: 0,
            documentId: "",
            error: data.error,
          });
        } else {
          newResults.push(data);
        }
      } catch {
        newResults.push({
          filename: file.name,
          category: "",
          priority: 0,
          tokenCount: 0,
          documentId: "",
          error: "Network error",
        });
      }
    }

    setResults((prev) => [...newResults, ...prev]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  };

  const loadDrivePreview = async () => {
    setDrivePreviewLoading(true);
    setDriveError(null);
    setDriveSyncResult(null);
    try {
      const res = await fetch("/api/admin/drive");
      const data = await res.json();
      if (!res.ok) {
        setDriveError(data.error ?? "Failed to load Drive preview");
      } else {
        setDrivePreview(data);
      }
    } catch {
      setDriveError("Network error");
    } finally {
      setDrivePreviewLoading(false);
    }
  };

  const executeDriveSync = async () => {
    setDriveSyncing(true);
    setDriveError(null);
    try {
      const res = await fetch("/api/admin/drive", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setDriveError(data.error ?? "Sync failed");
      } else {
        setDriveSyncResult(data);
        await loadDrivePreview();
      }
    } catch {
      setDriveError("Network error");
    } finally {
      setDriveSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-gray-700 text-sm">
              ← Back to Chat
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">
              Admin — Upload Documents
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/documents"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Manage Documents
            </Link>
            <Link
              href="/admin/costs"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Cost Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Upload area */}
        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
            dragOver
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 bg-white hover:border-gray-400"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-700 mb-2">
            Drop files here or click to upload
          </p>
          <p className="text-sm text-gray-400 mb-6">
            Supports PDF, DOCX, DOC, TXT, MD — up to 10MB each
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-blue-600 text-white rounded-xl px-6 py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {uploading ? "Uploading..." : "Select Files"}
          </button>
        </div>

        {/* Upload results */}
        {results.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Upload Results
            </h2>
            <div className="space-y-3">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`bg-white rounded-xl border p-4 flex items-start gap-4 ${
                    r.error ? "border-red-200" : "border-green-200"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm shrink-0 ${
                      r.error ? "bg-red-500" : "bg-green-500"
                    }`}
                  >
                    {r.error ? "✕" : "✓"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {r.filename}
                    </p>
                    {r.error ? (
                      <p className="text-sm text-red-600">{r.error}</p>
                    ) : (
                      <div className="flex gap-4 mt-1">
                        <span className="text-xs text-gray-500 capitalize">
                          Category: {r.category}
                        </span>
                        <span className="text-xs text-gray-500">
                          Priority: {r.priority}
                        </span>
                        <span className="text-xs text-gray-500">
                          ~{r.tokenCount.toLocaleString()} tokens
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Google Drive Sync */}
        <div className="mt-10">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.71 3.5L1.15 15l3.43 6 6.56-11.5L7.71 3.5zM22.85 15L16.29 3.5H9.17l6.56 11.5L22.85 15zM9.89 16.5L6.46 22.5h11.08l3.43-6H9.89z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Google Drive Sync
                  </h2>
                  <p className="text-sm text-gray-400">
                    Syncs PDF, DOCX, TXT and MD files from the configured folder
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={loadDrivePreview}
                  disabled={drivePreviewLoading || driveSyncing}
                  className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                >
                  {drivePreviewLoading ? "Loading..." : "Preview"}
                </button>
                <button
                  onClick={executeDriveSync}
                  disabled={driveSyncing || drivePreviewLoading}
                  className="bg-green-600 text-white rounded-xl px-5 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {driveSyncing ? "Syncing..." : "Sync from Google Drive"}
                </button>
              </div>
            </div>

            {/* Error */}
            {driveError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
                {driveError}
              </div>
            )}

            {/* Sync result */}
            {driveSyncResult && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 mb-4">
                <p className="text-sm font-medium text-green-800 mb-1">
                  Sync complete
                </p>
                <div className="flex gap-4 text-sm text-green-700">
                  <span>{driveSyncResult.added} added</span>
                  <span>{driveSyncResult.updated} updated</span>
                  <span>{driveSyncResult.unchanged} unchanged</span>
                </div>
                {driveSyncResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {driveSyncResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">
                        {err}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* File preview list */}
            {drivePreview && drivePreview.files.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-3">
                  {drivePreview.fileCount} file
                  {drivePreview.fileCount !== 1 ? "s" : ""} in folder
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {drivePreview.files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 text-sm"
                    >
                      <span className="text-gray-700 truncate mr-3">
                        {file.name}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          file.status === "new"
                            ? "bg-blue-100 text-blue-700"
                            : file.status === "update"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {file.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {drivePreview && drivePreview.files.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                No supported files found in the configured folder.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
