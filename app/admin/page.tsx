"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DocumentCategory } from "@/types";

interface UploadResult {
  filename: string;
  category: string;
  priority: number;
  tokenCount: number;
  documentId: string;
  error?: string;
}

interface WebSource {
  id: string;
  filename: string;
  sourceUrl: string;
  category: DocumentCategory;
  priority: number;
  tokenCount: number;
  lastFetched?: string;
  fetchError?: string;
}

const CATEGORIES: DocumentCategory[] = [
  "general",
  "hr",
  "engineering",
  "policy",
  "finance",
  "legal",
];

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

interface NotionPreviewPage {
  id: string;
  title: string;
  lastEdited: string;
  url: string;
  status: "new" | "update" | "unchanged";
}

interface NotionPreview {
  pageCount: number;
  pages: NotionPreviewPage[];
}

interface NotionSyncResult {
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

  const [notionSyncing, setNotionSyncing] = useState(false);
  const [notionPreviewLoading, setNotionPreviewLoading] = useState(false);
  const [notionPreview, setNotionPreview] = useState<NotionPreview | null>(null);
  const [notionSyncResult, setNotionSyncResult] = useState<NotionSyncResult | null>(null);
  const [notionError, setNotionError] = useState<string | null>(null);

  // Web sources state
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [loadingWebSources, setLoadingWebSources] = useState(true);
  const [webUrl, setWebUrl] = useState("");
  const [webCategory, setWebCategory] = useState<DocumentCategory>("general");
  const [webPriority, setWebPriority] = useState(50);
  const [crawlLinks, setCrawlLinks] = useState(true);
  const [addingWebSource, setAddingWebSource] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user?.isAdmin) {
      fetchWebSources();
    }
  }, [session?.user?.isAdmin]);

  const fetchWebSources = async () => {
    try {
      const res = await fetch("/api/admin/websites");
      const data = await res.json();
      if (res.ok) {
        setWebSources(data.websites);
      }
    } catch {
      console.error("Failed to fetch web sources");
    } finally {
      setLoadingWebSources(false);
    }
  };

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
          error: "Помилка мережі",
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
        setDriveError(data.error ?? "Не вдалося завантажити попередній перегляд Drive");
      } else {
        setDrivePreview(data);
      }
    } catch {
      setDriveError("Помилка мережі");
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
        setDriveError(data.error ?? "Синхронізація не вдалася");
      } else {
        setDriveSyncResult(data);
        await loadDrivePreview();
      }
    } catch {
      setDriveError("Помилка мережі");
    } finally {
      setDriveSyncing(false);
    }
  };

  const handleAddWebSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webUrl.trim()) return;

    setAddingWebSource(true);
    setWebError(null);

    try {
      const res = await fetch("/api/admin/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webUrl.trim(),
          category: webCategory,
          priority: webPriority,
          crawlLinks,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setWebError(data.error || "Не вдалося додати веб-джерело");
      } else {
        setWebUrl("");
        setWebCategory("general");
        setWebPriority(50);
        fetchWebSources();
      }
    } catch {
      setWebError("Помилка мережі");
    } finally {
      setAddingWebSource(false);
    }
  };

  const handleRefreshWebSource = async (id: string) => {
    setRefreshingId(id);

    try {
      const res = await fetch(`/api/admin/websites/${id}`, {
        method: "POST",
      });
      await res.json();
      fetchWebSources();
    } catch {
      console.error("Failed to refresh web source");
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDeleteWebSource = async (id: string) => {
    if (!confirm("Ви впевнені, що хочете видалити це веб-джерело?")) return;

    try {
      const res = await fetch(`/api/admin/websites/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setWebSources((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      console.error("Failed to delete web source");
    }
  };

  const loadNotionPreview = async () => {
    setNotionPreviewLoading(true);
    setNotionError(null);
    setNotionSyncResult(null);
    try {
      const res = await fetch("/api/admin/notion");
      const data = await res.json();
      if (!res.ok) {
        setNotionError(data.error ?? "Не вдалося завантажити сторінки Notion");
      } else {
        setNotionPreview(data);
      }
    } catch {
      setNotionError("Помилка мережі");
    } finally {
      setNotionPreviewLoading(false);
    }
  };

  const executeNotionSync = async () => {
    setNotionSyncing(true);
    setNotionError(null);
    try {
      const res = await fetch("/api/admin/notion", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setNotionError(data.error ?? "Синхронізація Notion не вдалася");
      } else {
        setNotionSyncResult(data);
        await loadNotionPreview();
      }
    } catch {
      setNotionError("Помилка мережі");
    } finally {
      setNotionSyncing(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Ніколи";
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-gray-700 text-sm">
              ← Назад до чату
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">
              Адмін — Завантаження документів
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/admin/documents"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Керування документами
            </Link>
            <Link
              href="/admin/costs"
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              Панель витрат
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
            Перетягніть файли сюди або натисніть для завантаження
          </p>
          <p className="text-sm text-gray-400 mb-6">
            Підтримує PDF, DOCX, DOC, TXT, MD — до 10МБ кожен
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
            {uploading ? "Завантаження..." : "Вибрати файли"}
          </button>
        </div>

        {/* Upload results */}
        {results.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Результати завантаження
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
                          Категорія: {r.category}
                        </span>
                        <span className="text-xs text-gray-500">
                          Пріоритет: {r.priority}
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
                    Синхронізація Google Drive
                  </h2>
                  <p className="text-sm text-gray-400">
                    Синхронізує PDF, DOCX, TXT та MD файли з налаштованої папки
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={loadDrivePreview}
                  disabled={drivePreviewLoading || driveSyncing}
                  className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                >
                  {drivePreviewLoading ? "Завантаження..." : "Попередній перегляд"}
                </button>
                <button
                  onClick={executeDriveSync}
                  disabled={driveSyncing || drivePreviewLoading}
                  className="bg-green-600 text-white rounded-xl px-5 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {driveSyncing ? "Синхронізація..." : "Синхронізувати з Google Drive"}
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
                  Синхронізацію завершено
                </p>
                <div className="flex gap-4 text-sm text-green-700">
                  <span>{driveSyncResult.added} додано</span>
                  <span>{driveSyncResult.updated} оновлено</span>
                  <span>{driveSyncResult.unchanged} без змін</span>
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
                  {drivePreview.fileCount} файл{drivePreview.fileCount === 1 ? "" : drivePreview.fileCount < 5 ? "и" : "ів"} у папці
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
                Підтримувані файли не знайдено у налаштованій папці.
              </p>
            )}
          </div>
        </div>

        {/* Web Sources Section */}
        <div className="mt-10">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Веб-джерела
                </h2>
                <p className="text-sm text-gray-400">
                  Додайте веб-сторінки як джерела для AI-асистента
                </p>
              </div>
            </div>

            {/* Add web source form */}
            <form onSubmit={handleAddWebSource} className="mb-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    URL
                  </label>
                  <input
                    type="url"
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    placeholder="https://example.com/page"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Категорія
                  </label>
                  <select
                    value={webCategory}
                    onChange={(e) => setWebCategory(e.target.value as DocumentCategory)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Пріоритет (0-100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={webPriority}
                    onChange={(e) => setWebPriority(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="crawlLinks"
                  checked={crawlLinks}
                  onChange={(e) => setCrawlLinks(e.target.checked)}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="crawlLinks" className="text-sm text-gray-700">
                  Сканувати всі сторінки сайту (до 20 сторінок)
                </label>
              </div>
              {webError && (
                <p className="mt-3 text-sm text-red-600">{webError}</p>
              )}
              <div className="mt-4">
                <button
                  type="submit"
                  disabled={addingWebSource || !webUrl.trim()}
                  className="bg-purple-600 text-white rounded-lg px-4 py-2 font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {addingWebSource ? "Додавання..." : "Додати веб-джерело"}
                </button>
              </div>
            </form>

            {/* Web sources list */}
            {loadingWebSources ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600" />
              </div>
            ) : webSources.length === 0 ? (
              <p className="text-center text-gray-400 py-8">
                Веб-джерела ще не додано
              </p>
            ) : (
              <div className="space-y-3">
                {webSources.map((source) => (
                  <div
                    key={source.id}
                    className={`rounded-xl border p-4 ${
                      source.fetchError ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {source.filename}
                        </p>
                        <a
                          href={source.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-purple-600 hover:underline truncate block"
                        >
                          {source.sourceUrl}
                        </a>
                        <div className="flex flex-wrap gap-4 mt-2">
                          <span className="text-xs text-gray-500 capitalize">
                            Категорія: {source.category}
                          </span>
                          <span className="text-xs text-gray-500">
                            Пріоритет: {source.priority}
                          </span>
                          <span className="text-xs text-gray-500">
                            ~{source.tokenCount.toLocaleString()} токенів
                          </span>
                          <span className="text-xs text-gray-500">
                            Оновлено: {formatDate(source.lastFetched)}
                          </span>
                        </div>
                        {source.fetchError && (
                          <p className="text-sm text-red-600 mt-2">
                            Помилка: {source.fetchError}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleRefreshWebSource(source.id)}
                          disabled={refreshingId === source.id}
                          className="text-sm px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
                        >
                          {refreshingId === source.id ? "..." : "Оновити"}
                        </button>
                        <button
                          onClick={() => handleDeleteWebSource(source.id)}
                          className="text-sm px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                        >
                          Видалити
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Notion Sync Section */}
        <div className="mt-10">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Синхронізація Notion
                  </h2>
                  <p className="text-sm text-gray-400">
                    Синхронізує сторінки з вашого Notion workspace
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={loadNotionPreview}
                  disabled={notionPreviewLoading || notionSyncing}
                  className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                >
                  {notionPreviewLoading ? "Завантаження..." : "Попередній перегляд"}
                </button>
                <button
                  onClick={executeNotionSync}
                  disabled={notionSyncing || notionPreviewLoading}
                  className="bg-gray-900 text-white rounded-xl px-5 py-2 text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {notionSyncing ? "Синхронізація..." : "Синхронізувати з Notion"}
                </button>
              </div>
            </div>

            {/* Error */}
            {notionError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
                {notionError}
              </div>
            )}

            {/* Sync result */}
            {notionSyncResult && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 mb-4">
                <p className="text-sm font-medium text-green-800 mb-1">
                  Синхронізацію завершено
                </p>
                <div className="flex gap-4 text-sm text-green-700">
                  <span>{notionSyncResult.added} додано</span>
                  <span>{notionSyncResult.updated} оновлено</span>
                  <span>{notionSyncResult.unchanged} без змін</span>
                </div>
                {notionSyncResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {notionSyncResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">
                        {err}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Page preview list */}
            {notionPreview && notionPreview.pages.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-3">
                  {notionPreview.pageCount} сторінк{notionPreview.pageCount === 1 ? "а" : notionPreview.pageCount < 5 ? "и" : "ок"} у workspace
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {notionPreview.pages.map((page) => (
                    <div
                      key={page.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 text-sm"
                    >
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-700 hover:text-gray-900 hover:underline truncate mr-3"
                      >
                        {page.title}
                      </a>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          page.status === "new"
                            ? "bg-blue-100 text-blue-700"
                            : page.status === "update"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {page.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {notionPreview && notionPreview.pages.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                Сторінки не знайдено. Переконайтесь, що ви надали доступ до сторінок у Notion інтеграції.
              </p>
            )}

            {!notionPreview && !notionError && (
              <p className="text-sm text-gray-400 text-center py-4">
                Натисніть «Попередній перегляд» щоб побачити сторінки Notion, або «Синхронізувати» для негайного запуску.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
