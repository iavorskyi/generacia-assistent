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
  mimeType: string;
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

type Tab = "files" | "drive" | "web" | "notion" | "settings";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "files",
    label: "Файли",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    ),
  },
  {
    id: "drive",
    label: "Google Drive",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.71 3.5L1.15 15l3.43 6 6.56-11.5L7.71 3.5zM22.85 15L16.29 3.5H9.17l6.56 11.5L22.85 15zM9.89 16.5L6.46 22.5h11.08l3.43-6H9.89z" />
      </svg>
    ),
  },
  {
    id: "web",
    label: "Веб-сайти",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
  },
  {
    id: "notion",
    label: "Notion",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Налаштування",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function AdminUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>("files");

  // Files state
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Drive state
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveSyncProgress, setDriveSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [drivePreviewLoading, setDrivePreviewLoading] = useState(false);
  const [drivePreview, setDrivePreview] = useState<DrivePreview | null>(null);
  const [driveSyncResult, setDriveSyncResult] = useState<DriveSyncResult | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  // Settings state
  const [aiProvider, setAiProvider] = useState<"claude" | "gemini" | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Notion state
  const [notionSyncing, setNotionSyncing] = useState(false);
  const [notionSyncProgress, setNotionSyncProgress] = useState<{ current: number; total: number } | null>(null);
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

  useEffect(() => {
    if (activeTab === "settings" && session?.user?.isAdmin && aiProvider === null) {
      loadSettings();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, session?.user?.isAdmin]);

  const fetchWebSources = async () => {
    try {
      const res = await fetch("/api/admin/websites");
      const data = await res.json();
      if (res.ok) setWebSources(data.websites);
    } catch {
      console.error("Failed to fetch web sources");
    } finally {
      setLoadingWebSources(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ff8319]" />
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
        const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          newResults.push({ filename: file.name, category: "", priority: 0, tokenCount: 0, documentId: "", error: data.error });
        } else {
          newResults.push(data);
        }
      } catch {
        newResults.push({ filename: file.name, category: "", priority: 0, tokenCount: 0, documentId: "", error: "Помилка мережі" });
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
      if (!res.ok) setDriveError(data.error ?? "Не вдалося завантажити попередній перегляд Drive");
      else setDrivePreview(data);
    } catch {
      setDriveError("Помилка мережі");
    } finally {
      setDrivePreviewLoading(false);
    }
  };

  const executeDriveSync = async () => {
    setDriveSyncing(true);
    setDriveSyncProgress(null);
    setDriveError(null);
    setDriveSyncResult(null);

    try {
      // Step 1: fetch the list of files
      const previewRes = await fetch("/api/admin/drive");
      const previewData = await previewRes.json();
      if (!previewRes.ok) {
        setDriveError(previewData.error ?? "Не вдалося отримати файли Drive");
        return;
      }
      const files: DrivePreviewFile[] = previewData.files;

      const result: DriveSyncResult = { added: 0, updated: 0, unchanged: 0, errors: [] };

      // Step 2: sync each file individually
      for (let i = 0; i < files.length; i++) {
        setDriveSyncProgress({ current: i + 1, total: files.length });
        const file = files[i];
        try {
          const res = await fetch("/api/admin/drive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              modifiedTime: file.modifiedTime,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            result.errors.push(`${file.name}: ${data.error ?? "Unknown error"}`);
          } else {
            result[data.status as "added" | "updated" | "unchanged"]++;
          }
        } catch {
          result.errors.push(`${file.name}: Помилка мережі`);
        }
      }

      setDriveSyncResult(result);
      setDrivePreview(previewData);
    } catch {
      setDriveError("Помилка мережі");
    } finally {
      setDriveSyncing(false);
      setDriveSyncProgress(null);
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
        body: JSON.stringify({ url: webUrl.trim(), category: webCategory, priority: webPriority, crawlLinks }),
      });
      const data = await res.json();
      if (!res.ok) setWebError(data.error || "Не вдалося додати веб-джерело");
      else {
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
      await fetch(`/api/admin/websites/${id}`, { method: "POST" });
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
      const res = await fetch(`/api/admin/websites/${id}`, { method: "DELETE" });
      if (res.ok) setWebSources((prev) => prev.filter((s) => s.id !== id));
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
      if (!res.ok) setNotionError(data.error ?? "Не вдалося завантажити сторінки Notion");
      else setNotionPreview(data);
    } catch {
      setNotionError("Помилка мережі");
    } finally {
      setNotionPreviewLoading(false);
    }
  };

  const executeNotionSync = async () => {
    setNotionSyncing(true);
    setNotionSyncProgress(null);
    setNotionError(null);
    setNotionSyncResult(null);

    try {
      // Step 1: fetch the list of pages
      const previewRes = await fetch("/api/admin/notion");
      const previewData = await previewRes.json();
      if (!previewRes.ok) {
        setNotionError(previewData.error ?? "Не вдалося отримати сторінки Notion");
        return;
      }
      const pages: NotionPreviewPage[] = previewData.pages;

      const result: NotionSyncResult = { added: 0, updated: 0, unchanged: 0, errors: [] };

      // Step 2: sync each page individually
      for (let i = 0; i < pages.length; i++) {
        setNotionSyncProgress({ current: i + 1, total: pages.length });
        const page = pages[i];
        try {
          const res = await fetch("/api/admin/notion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageId: page.id, title: page.title, lastEdited: page.lastEdited }),
          });
          const data = await res.json();
          if (!res.ok) {
            result.errors.push(`${page.title}: ${data.error ?? "Unknown error"}`);
          } else {
            result[data.status as "added" | "updated" | "unchanged"]++;
          }
        } catch {
          result.errors.push(`${page.title}: Помилка мережі`);
        }
      }

      setNotionSyncResult(result);
      setNotionPreview(previewData);
    } catch {
      setNotionError("Помилка мережі");
    } finally {
      setNotionSyncing(false);
      setNotionSyncProgress(null);
    }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (res.ok) setAiProvider(data.provider);
      else setSettingsError(data.error ?? "Не вдалося завантажити налаштування");
    } catch {
      setSettingsError("Помилка мережі");
    } finally {
      setSettingsLoading(false);
    }
  };

  const switchProvider = async (provider: "claude" | "gemini") => {
    if (provider === aiProvider) return;
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiProvider(data.provider);
        setSettingsSuccess(true);
        setTimeout(() => setSettingsSuccess(false), 3000);
      } else {
        setSettingsError(data.error ?? "Не вдалося зберегти налаштування");
      }
    } catch {
      setSettingsError("Помилка мережі");
    } finally {
      setSettingsSaving(false);
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
            <h1 className="text-xl font-semibold text-gray-900">Джерела знань</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/documents" className="text-sm text-[#ff8319] hover:text-[#e6730d]">
              Документи
            </Link>
            <Link href="/admin/costs" className="text-sm text-[#ff8319] hover:text-[#e6730d]">
              Витрати
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Files */}
        {activeTab === "files" && (
          <div>
            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
                dragOver ? "border-[#ff8319] bg-orange-50" : "border-gray-300 bg-white hover:border-gray-400"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[#ff8319]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
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
                className="bg-[#ff8319] text-white rounded-xl px-6 py-2.5 font-medium hover:bg-[#e6730d] disabled:opacity-50 transition-colors"
              >
                {uploading ? "Завантаження..." : "Вибрати файли"}
              </button>
            </div>

            {results.length > 0 && (
              <div className="mt-8">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Результати завантаження</h2>
                <div className="space-y-3">
                  {results.map((r, i) => (
                    <div key={i} className={`bg-white rounded-xl border p-4 flex items-start gap-4 ${r.error ? "border-red-200" : "border-green-200"}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm shrink-0 ${r.error ? "bg-red-500" : "bg-green-500"}`}>
                        {r.error ? "✕" : "✓"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.filename}</p>
                        {r.error ? (
                          <p className="text-sm text-red-600">{r.error}</p>
                        ) : (
                          <div className="flex gap-4 mt-1">
                            <span className="text-xs text-gray-500 capitalize">Категорія: {r.category}</span>
                            <span className="text-xs text-gray-500">Пріоритет: {r.priority}</span>
                            <span className="text-xs text-gray-500">~{r.tokenCount.toLocaleString()} tokens</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Google Drive */}
        {activeTab === "drive" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Google Drive</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  Синхронізує PDF, DOCX, TXT та MD файли з налаштованої папки
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={loadDrivePreview}
                  disabled={drivePreviewLoading || driveSyncing}
                  className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                >
                  {drivePreviewLoading ? "Завантаження..." : "Переглянути"}
                </button>
                <button
                  onClick={executeDriveSync}
                  disabled={driveSyncing || drivePreviewLoading}
                  className="bg-green-600 text-white rounded-xl px-5 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {driveSyncing
                    ? driveSyncProgress
                      ? `${driveSyncProgress.current}/${driveSyncProgress.total}...`
                      : "Завантаження..."
                    : "Синхронізувати"}
                </button>
              </div>
            </div>

            {driveSyncing && driveSyncProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Синхронізація файлів...</span>
                  <span>{driveSyncProgress.current} / {driveSyncProgress.total}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${(driveSyncProgress.current / driveSyncProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {driveError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
                {driveError}
              </div>
            )}

            {driveSyncResult && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 mb-4">
                <p className="text-sm font-medium text-green-800 mb-1">Синхронізацію завершено</p>
                <div className="flex gap-4 text-sm text-green-700">
                  <span>{driveSyncResult.added} додано</span>
                  <span>{driveSyncResult.updated} оновлено</span>
                  <span>{driveSyncResult.unchanged} без змін</span>
                </div>
                {driveSyncResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {driveSyncResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {drivePreview && drivePreview.files.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-3">
                  {drivePreview.fileCount} файл{drivePreview.fileCount === 1 ? "" : drivePreview.fileCount < 5 ? "и" : "ів"} у папці
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {drivePreview.files.map((file) => (
                    <div key={file.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 text-sm">
                      <span className="text-gray-700 truncate mr-3">{file.name}</span>
                      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        file.status === "new" ? "bg-orange-100 text-[#cc6b14]" : file.status === "update" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {file.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {drivePreview && drivePreview.files.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                Підтримувані файли не знайдено у налаштованій папці.
              </p>
            )}

            {!drivePreview && !driveError && (
              <p className="text-sm text-gray-400 text-center py-8">
                Натисніть «Переглянути» щоб побачити файли, або «Синхронізувати» для негайного запуску.
              </p>
            )}
          </div>
        )}

        {/* Tab: Web Sources */}
        {activeTab === "web" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">Веб-сайти</h2>
              <p className="text-sm text-gray-400 mt-0.5">Додайте веб-сторінки як джерела для AI-асистента</p>
            </div>

            <form onSubmit={handleAddWebSource} className="mb-8 p-4 bg-gray-50 rounded-xl">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
                  <input
                    type="url"
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    placeholder="https://example.com/page"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ff8319] focus:border-transparent bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Категорія</label>
                  <select
                    value={webCategory}
                    onChange={(e) => setWebCategory(e.target.value as DocumentCategory)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ff8319] focus:border-transparent bg-white"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Пріоритет (0-100)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={webPriority}
                    onChange={(e) => setWebPriority(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ff8319] focus:border-transparent bg-white"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="crawlLinks"
                  checked={crawlLinks}
                  onChange={(e) => setCrawlLinks(e.target.checked)}
                  className="w-4 h-4 text-[#ff8319] border-gray-300 rounded accent-[#ff8319]"
                />
                <label htmlFor="crawlLinks" className="text-sm text-gray-700">
                  Сканувати всі сторінки сайту
                </label>
              </div>
              {webError && <p className="mt-3 text-sm text-red-600">{webError}</p>}
              <div className="mt-4">
                <button
                  type="submit"
                  disabled={addingWebSource || !webUrl.trim()}
                  className="bg-[#ff8319] text-white rounded-lg px-4 py-2 font-medium hover:bg-[#e6730d] disabled:opacity-50 transition-colors"
                >
                  {addingWebSource ? "Додавання..." : "Додати"}
                </button>
              </div>
            </form>

            {loadingWebSources ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" />
              </div>
            ) : webSources.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Веб-джерела ще не додано</p>
            ) : (
              <div className="space-y-3">
                {webSources.map((source) => (
                  <div
                    key={source.id}
                    className={`rounded-xl border p-4 ${source.fetchError ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{source.filename}</p>
                        <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-[#ff8319] hover:underline truncate block">
                          {source.sourceUrl}
                        </a>
                        <div className="flex flex-wrap gap-4 mt-2">
                          <span className="text-xs text-gray-500 capitalize">Категорія: {source.category}</span>
                          <span className="text-xs text-gray-500">Пріоритет: {source.priority}</span>
                          <span className="text-xs text-gray-500">~{source.tokenCount.toLocaleString()} токенів</span>
                          <span className="text-xs text-gray-500">Оновлено: {formatDate(source.lastFetched)}</span>
                        </div>
                        {source.fetchError && <p className="text-sm text-red-600 mt-2">Помилка: {source.fetchError}</p>}
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
        )}

        {/* Tab: Notion */}
        {activeTab === "notion" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Notion</h2>
                <p className="text-sm text-gray-400 mt-0.5">Синхронізує сторінки з вашого Notion workspace</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={loadNotionPreview}
                  disabled={notionPreviewLoading || notionSyncing}
                  className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
                >
                  {notionPreviewLoading ? "Завантаження..." : "Переглянути"}
                </button>
                <button
                  onClick={executeNotionSync}
                  disabled={notionSyncing || notionPreviewLoading}
                  className="bg-gray-900 text-white rounded-xl px-5 py-2 text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {notionSyncing
                    ? notionSyncProgress
                      ? `${notionSyncProgress.current}/${notionSyncProgress.total}...`
                      : "Завантаження..."
                    : "Синхронізувати"}
                </button>
              </div>
            </div>

            {notionError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
                {notionError}
              </div>
            )}

            {notionSyncResult && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 mb-4">
                <p className="text-sm font-medium text-green-800 mb-1">Синхронізацію завершено</p>
                <div className="flex gap-4 text-sm text-green-700">
                  <span>{notionSyncResult.added} додано</span>
                  <span>{notionSyncResult.updated} оновлено</span>
                  <span>{notionSyncResult.unchanged} без змін</span>
                </div>
                {notionSyncResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {notionSyncResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {notionPreview && notionPreview.pages.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-3">
                  {notionPreview.pageCount} сторінк{notionPreview.pageCount === 1 ? "а" : notionPreview.pageCount < 5 ? "и" : "ок"} у workspace
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {notionPreview.pages.map((page) => (
                    <div key={page.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 text-sm">
                      <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:text-gray-900 hover:underline truncate mr-3">
                        {page.title}
                      </a>
                      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        page.status === "new" ? "bg-orange-100 text-[#cc6b14]" : page.status === "update" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {page.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {notionPreview && notionPreview.pages.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                Сторінки не знайдено. Переконайтесь, що ви надали доступ до сторінок у Notion інтеграції.
              </p>
            )}

            {!notionPreview && !notionError && (
              <p className="text-sm text-gray-400 text-center py-8">
                Натисніть «Переглянути» щоб побачити сторінки Notion, або «Синхронізувати» для негайного запуску.
              </p>
            )}
          </div>
        )}

        {/* Tab: Settings */}
        {activeTab === "settings" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">AI Модель</h2>
              <p className="text-sm text-gray-400 mt-0.5">Оберіть AI-провайдера для відповідей асистента</p>
            </div>

            {aiProvider === null && !settingsLoading && (
              <div className="text-center py-8">
                <button
                  onClick={loadSettings}
                  className="text-sm text-[#ff8319] hover:text-[#e6730d]"
                >
                  Завантажити налаштування
                </button>
              </div>
            )}

            {settingsLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" />
              </div>
            )}

            {settingsError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">
                {settingsError}
              </div>
            )}

            {settingsSuccess && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 mb-4">
                Налаштування збережено
              </div>
            )}

            {aiProvider !== null && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Claude card */}
                <button
                  onClick={() => switchProvider("claude")}
                  disabled={settingsSaving}
                  className={`text-left p-5 rounded-xl border-2 transition-all disabled:opacity-50 ${
                    aiProvider === "claude"
                      ? "border-[#ff8319] bg-orange-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900">Claude Haiku</span>
                    {aiProvider === "claude" && (
                      <span className="text-xs font-medium bg-[#ff8319] text-white px-2 py-0.5 rounded-full">
                        Активний
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-1">Anthropic</p>
                  <div className="space-y-0.5 text-xs text-gray-400">
                    <p>Вхідні: $0.25 / 1M токенів</p>
                    <p>Вихідні: $1.25 / 1M токенів</p>
                    <p className="text-green-600">+ Промпт-кешування</p>
                  </div>
                </button>

                {/* Gemini card */}
                <button
                  onClick={() => switchProvider("gemini")}
                  disabled={settingsSaving}
                  className={`text-left p-5 rounded-xl border-2 transition-all disabled:opacity-50 ${
                    aiProvider === "gemini"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900">Gemini 2.5 Flash</span>
                    {aiProvider === "gemini" && (
                      <span className="text-xs font-medium bg-blue-500 text-white px-2 py-0.5 rounded-full">
                        Активний
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-1">Google</p>
                  <div className="space-y-0.5 text-xs text-gray-400">
                    <p>Вхідні: $0.15 / 1M токенів</p>
                    <p>Вихідні: $0.60 / 1M токенів</p>
                    <p className="text-blue-500">~2× дешевше на виході</p>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
