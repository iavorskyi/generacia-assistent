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

export default function AdminUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);

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
      </main>
    </div>
  );
}
