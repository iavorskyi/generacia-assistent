"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DocumentCategory } from "@/types";

// ─── Interfaces ────────────────────────────────────────────────────────────────

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

interface DocumentRow {
  id: string;
  filename: string;
  category: DocumentCategory;
  priority: number;
  tokenCount: number;
  sourceType?: string;
  driveFileId?: string;
  notionPageId?: string;
  sourceUrl?: string;
  uploadedAt?: unknown;
  lastFetched?: unknown;
  fetchError?: string;
  driveModifiedTime?: string;
  notionLastEdited?: string;
}

interface DrivePreviewFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
  status: "new" | "update" | "unchanged";
}

interface DriveTableRow {
  driveFileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
  status: "new" | "update" | "unchanged" | "orphaned";
  documentId?: string;
  category?: DocumentCategory;
  priority?: number;
  tokenCount?: number;
}

interface NotionPreviewPage {
  id: string;
  title: string;
  lastEdited: string;
  url: string;
  status: "new" | "update" | "unchanged";
}

interface NotionTableRow {
  notionPageId: string;
  title: string;
  url: string;
  lastEdited: string;
  status: "new" | "update" | "unchanged" | "orphaned";
  documentId?: string;
  category?: DocumentCategory;
  tokenCount?: number;
}

interface SortConfig { key: string; dir: "asc" | "desc" }

// ─── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES: DocumentCategory[] = [
  "general", "hr", "engineering", "policy", "finance", "legal",
];

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(sizeStr: string | undefined): string {
  const size = parseInt(sizeStr ?? "0");
  if (!size || isNaN(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  if (typeof value === "string") {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
      " " + d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const d = new Date((value as { seconds: number }).seconds * 1000);
    return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
      " " + d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  }
  return "—";
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { bg: string; text: string; label: string }> = {
    new:       { bg: "bg-blue-50",   text: "text-blue-700",  label: "Новий" },
    update:    { bg: "bg-amber-50",  text: "text-amber-700", label: "Оновлено" },
    unchanged: { bg: "bg-green-50",  text: "text-green-700", label: "Актуальний" },
    orphaned:  { bg: "bg-gray-100",  text: "text-gray-500",  label: "Видалено з джерела" },
    ok:        { bg: "bg-green-50",  text: "text-green-700", label: "ОК" },
    error:     { bg: "bg-red-50",    text: "text-red-600",   label: "Помилка" },
  };
  const cfg = configs[status] ?? { bg: "bg-gray-100", text: "text-gray-500", label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text} whitespace-nowrap`}>
      {cfg.label}
    </span>
  );
}

function applySort<T extends Record<string, unknown>>(
  rows: T[], sort: SortConfig
): T[] {
  return [...rows].sort((a, b) => {
    const va = String(a[sort.key] ?? "").toLowerCase();
    const vb = String(b[sort.key] ?? "").toLowerCase();
    const cmp = va.localeCompare(vb, "uk");
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>("files");

  // ── Table visibility (collapsed by default) ──
  const [driveTableVisible, setDriveTableVisible] = useState(false);
  const [notionTableVisible, setNotionTableVisible] = useState(false);
  const [fileTableVisible, setFileTableVisible] = useState(false);
  const [webTableVisible, setWebTableVisible] = useState(false);

  // ── Upload (Files tab) ──
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // ── Files table ──
  const [fileDocs, setFileDocs] = useState<DocumentRow[]>([]);
  const [fileDocsLoading, setFileDocsLoading] = useState(false);
  const [fileSelected, setFileSelected] = useState<Set<string>>(new Set());
  const [fileSort, setFileSort] = useState<SortConfig>({ key: "uploadedAt", dir: "desc" });
  const [fileSearch, setFileSearch] = useState("");
  const [fileCatFilter, setFileCatFilter] = useState("");
  const [fileDocsLoaded, setFileDocsLoaded] = useState(false);

  // ── Drive table ──
  const [driveRows, setDriveRows] = useState<DriveTableRow[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveSelected, setDriveSelected] = useState<Set<string>>(new Set());
  const [driveSort, setDriveSort] = useState<SortConfig>({ key: "name", dir: "asc" });
  const [driveSearch, setDriveSearch] = useState("");
  const [driveCatFilter, setDriveCatFilter] = useState("");
  const [driveStatusFilter, setDriveStatusFilter] = useState("");
  const [driveSyncingIds, setDriveSyncingIds] = useState<Set<string>>(new Set());
  const [driveSyncProgress, setDriveSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [driveLoaded, setDriveLoaded] = useState(false);

  // ── Notion table ──
  const [notionRows, setNotionRows] = useState<NotionTableRow[]>([]);
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [notionSelected, setNotionSelected] = useState<Set<string>>(new Set());
  const [notionSort, setNotionSort] = useState<SortConfig>({ key: "title", dir: "asc" });
  const [notionSearch, setNotionSearch] = useState("");
  const [notionCatFilter, setNotionCatFilter] = useState("");
  const [notionStatusFilter, setNotionStatusFilter] = useState("");
  const [notionSyncingIds, setNotionSyncingIds] = useState<Set<string>>(new Set());
  const [notionSyncProgress, setNotionSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [notionLoaded, setNotionLoaded] = useState(false);

  // ── Web sources ──
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [loadingWebSources, setLoadingWebSources] = useState(false);
  const [webUrl, setWebUrl] = useState("");
  const [webCategory, setWebCategory] = useState<DocumentCategory>("general");
  const [webPriority, setWebPriority] = useState(50);
  const [crawlLinks, setCrawlLinks] = useState(true);
  const [addingWebSource, setAddingWebSource] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [webSelected, setWebSelected] = useState<Set<string>>(new Set());
  const [webSort, setWebSort] = useState<SortConfig>({ key: "filename", dir: "asc" });
  const [webSearch, setWebSearch] = useState("");
  const [webCatFilter, setWebCatFilter] = useState("");
  const [webStatusFilter, setWebStatusFilter] = useState("");

  // ── Settings ──
  const [aiProvider, setAiProvider] = useState<"claude" | "gemini" | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // ── Telegram ──
  const [telegramUsers, setTelegramUsers] = useState<string[] | null>(null);
  const [telegramUsersLoading, setTelegramUsersLoading] = useState(false);
  const [telegramUserInput, setTelegramUserInput] = useState("");
  const [telegramUsersSaving, setTelegramUsersSaving] = useState(false);
  const [telegramUsersError, setTelegramUsersError] = useState<string | null>(null);

  // ─── Load functions ──────────────────────────────────────────────────────────

  const loadDriveTab = useCallback(async () => {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const [driveRes, fsRes] = await Promise.all([
        fetch("/api/admin/drive"),
        fetch("/api/admin/documents?source=drive"),
      ]);
      const driveData = await driveRes.json();
      const fsData = await fsRes.json();

      if (!driveRes.ok) {
        setDriveError(driveData.error ?? "Не вдалося завантажити Drive");
        return;
      }

      const driveFiles: DrivePreviewFile[] = driveData.files ?? [];
      const fsDocs: DocumentRow[] = fsData.documents ?? [];
      const fsDocsByDriveId = new Map(fsDocs.filter(d => d.driveFileId).map(d => [d.driveFileId!, d]));
      const driveFileIds = new Set(driveFiles.map(f => f.id));

      const rows: DriveTableRow[] = [];

      for (const file of driveFiles) {
        const fsDoc = fsDocsByDriveId.get(file.id);
        rows.push({
          driveFileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          size: file.size,
          status: file.status,
          documentId: fsDoc?.id,
          category: fsDoc?.category,
          priority: fsDoc?.priority,
          tokenCount: fsDoc?.tokenCount,
        });
      }

      // Orphaned: in Firestore but not in Drive anymore
      for (const fsDoc of fsDocs) {
        if (fsDoc.driveFileId && !driveFileIds.has(fsDoc.driveFileId)) {
          rows.push({
            driveFileId: fsDoc.driveFileId,
            name: fsDoc.filename,
            mimeType: "",
            modifiedTime: fsDoc.driveModifiedTime ?? "",
            size: "",
            status: "orphaned",
            documentId: fsDoc.id,
            category: fsDoc.category,
            priority: fsDoc.priority,
            tokenCount: fsDoc.tokenCount,
          });
        }
      }

      setDriveRows(rows);
      setDriveLoaded(true);
    } catch {
      setDriveError("Помилка мережі");
    } finally {
      setDriveLoading(false);
    }
  }, []);

  const loadNotionTab = useCallback(async () => {
    setNotionLoading(true);
    setNotionError(null);
    try {
      const [notionRes, fsRes] = await Promise.all([
        fetch("/api/admin/notion"),
        fetch("/api/admin/documents?source=notion"),
      ]);
      const notionData = await notionRes.json();
      const fsData = await fsRes.json();

      if (!notionRes.ok) {
        setNotionError(notionData.error ?? "Не вдалося завантажити Notion");
        return;
      }

      const notionPages: NotionPreviewPage[] = notionData.pages ?? [];
      const fsDocs: DocumentRow[] = fsData.documents ?? [];
      const fsDocsByNotionId = new Map(fsDocs.filter(d => d.notionPageId).map(d => [d.notionPageId!, d]));
      const notionPageIds = new Set(notionPages.map(p => p.id));

      const rows: NotionTableRow[] = [];

      for (const page of notionPages) {
        const fsDoc = fsDocsByNotionId.get(page.id);
        rows.push({
          notionPageId: page.id,
          title: page.title,
          url: page.url,
          lastEdited: page.lastEdited,
          status: page.status,
          documentId: fsDoc?.id,
          category: fsDoc?.category,
          tokenCount: fsDoc?.tokenCount,
        });
      }

      // Orphaned: in Firestore but not in Notion anymore
      for (const fsDoc of fsDocs) {
        if (fsDoc.notionPageId && !notionPageIds.has(fsDoc.notionPageId)) {
          rows.push({
            notionPageId: fsDoc.notionPageId,
            title: fsDoc.filename.replace(/\.md$/, ""),
            url: fsDoc.sourceUrl ?? `https://www.notion.so/${fsDoc.notionPageId}`,
            lastEdited: "",
            status: "orphaned",
            documentId: fsDoc.id,
            category: fsDoc.category,
            tokenCount: fsDoc.tokenCount,
          });
        }
      }

      setNotionRows(rows);
      setNotionLoaded(true);
    } catch {
      setNotionError("Помилка мережі");
    } finally {
      setNotionLoading(false);
    }
  }, []);

  const loadFilesTab = useCallback(async () => {
    setFileDocsLoading(true);
    try {
      const res = await fetch("/api/admin/documents");
      const data = await res.json();
      if (res.ok) {
        const filtered = (data.documents ?? []).filter(
          (d: DocumentRow) => !["drive", "notion", "web"].includes(d.sourceType ?? "")
        );
        setFileDocs(filtered);
        setFileDocsLoaded(true);
      }
    } catch {
      console.error("Failed to load files");
    } finally {
      setFileDocsLoading(false);
    }
  }, []);

  const fetchWebSources = useCallback(async () => {
    setLoadingWebSources(true);
    try {
      const res = await fetch("/api/admin/websites");
      const data = await res.json();
      if (res.ok) setWebSources(data.websites);
    } catch {
      console.error("Failed to fetch web sources");
    } finally {
      setLoadingWebSources(false);
    }
  }, []);

  // Auth redirect — must be in useEffect, not during render
  useEffect(() => {
    if (status !== "loading" && !session?.user?.isAdmin) {
      router.replace("/");
    }
  }, [status, session, router]);

  // Load all data on mount (as soon as admin session is confirmed)
  useEffect(() => {
    if (!session?.user?.isAdmin) return;
    loadDriveTab();
    loadNotionTab();
    loadFilesTab();
    fetchWebSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.isAdmin]);

  // Settings: lazy-load only when settings tab is opened
  useEffect(() => {
    if (!session?.user?.isAdmin) return;
    if (activeTab === "settings") {
      if (aiProvider === null) loadSettings();
      if (telegramUsers === null) loadTelegramUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, session?.user?.isAdmin]);

  // ─── Update category ─────────────────────────────────────────────────────────

  const updateDocumentCategory = async (documentId: string, category: DocumentCategory) => {
    await fetch(`/api/admin/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
  };

  const updateDriveCategory = async (row: DriveTableRow, category: DocumentCategory) => {
    if (!row.documentId) return;
    setDriveRows(prev => prev.map(r => r.driveFileId === row.driveFileId ? { ...r, category } : r));
    await updateDocumentCategory(row.documentId, category);
  };

  const updateNotionCategory = async (row: NotionTableRow, category: DocumentCategory) => {
    if (!row.documentId) return;
    setNotionRows(prev => prev.map(r => r.notionPageId === row.notionPageId ? { ...r, category } : r));
    await updateDocumentCategory(row.documentId, category);
  };

  const updateFileCategory = async (docId: string, category: DocumentCategory) => {
    setFileDocs(prev => prev.map(d => d.id === docId ? { ...d, category } : d));
    await updateDocumentCategory(docId, category);
  };

  const updateWebCategory = async (docId: string, category: DocumentCategory) => {
    setWebSources(prev => prev.map(d => d.id === docId ? { ...d, category } : d));
    await updateDocumentCategory(docId, category);
  };

  // ─── Delete ──────────────────────────────────────────────────────────────────

  const bulkDelete = async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return false;
    const noun = ids.length === 1 ? "документ" : ids.length < 5 ? "документи" : "документів";
    if (!confirm(`Видалити ${ids.length} ${noun} з бази знань?\nЦю дію не можна скасувати.`)) return false;

    const res = await fetch("/api/admin/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    return res.ok;
  };

  const deleteDriveSelected = async () => {
    const ids = driveRows
      .filter(r => driveSelected.has(r.driveFileId) && r.documentId)
      .map(r => r.documentId!);
    if (ids.length === 0) { alert("Вибрані файли ще не синхронізовані — нічого видаляти"); return; }
    const ok = await bulkDelete(ids);
    if (ok) { setDriveSelected(new Set()); await loadDriveTab(); }
  };

  const deleteNotionSelected = async () => {
    const ids = notionRows
      .filter(r => notionSelected.has(r.notionPageId) && r.documentId)
      .map(r => r.documentId!);
    if (ids.length === 0) { alert("Вибрані сторінки ще не синхронізовані — нічого видаляти"); return; }
    const ok = await bulkDelete(ids);
    if (ok) { setNotionSelected(new Set()); await loadNotionTab(); }
  };

  const deleteFileSelected = async () => {
    const ids = Array.from(fileSelected);
    const ok = await bulkDelete(ids);
    if (ok) { setFileSelected(new Set()); await loadFilesTab(); }
  };

  const deleteWebSelected = async () => {
    const ids = Array.from(webSelected);
    const ok = await bulkDelete(ids);
    if (ok) { setWebSelected(new Set()); await fetchWebSources(); }
  };

  // ─── Drive sync ──────────────────────────────────────────────────────────────

  const syncDriveRowInternal = async (row: DriveTableRow): Promise<void> => {
    if (row.status === "orphaned" || !row.mimeType) return;
    setDriveSyncingIds(prev => { const s = new Set(prev); s.add(row.driveFileId); return s; });
    try {
      await fetch("/api/admin/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: row.driveFileId,
          name: row.name,
          mimeType: row.mimeType,
          modifiedTime: row.modifiedTime,
        }),
      });
    } finally {
      setDriveSyncingIds(prev => { const s = new Set(prev); s.delete(row.driveFileId); return s; });
    }
  };

  const syncDriveRow = async (row: DriveTableRow) => {
    await syncDriveRowInternal(row);
    await loadDriveTab();
  };

  const syncDriveSelected = async () => {
    const toSync = driveRows.filter(r =>
      driveSelected.has(r.driveFileId) && r.status !== "orphaned" && r.mimeType
    );
    if (toSync.length === 0) return;
    for (let i = 0; i < toSync.length; i++) {
      setDriveSyncProgress({ current: i + 1, total: toSync.length });
      await syncDriveRowInternal(toSync[i]);
    }
    setDriveSyncProgress(null);
    setDriveSelected(new Set());
    await loadDriveTab();
  };

  const syncAllDrive = async () => {
    const toSync = driveRows.filter(r => r.status === "new" || r.status === "update");
    if (toSync.length === 0) return;
    setDriveSyncProgress({ current: 0, total: toSync.length });
    for (let i = 0; i < toSync.length; i++) {
      await syncDriveRowInternal(toSync[i]);
      setDriveSyncProgress({ current: i + 1, total: toSync.length });
    }
    setDriveSyncProgress(null);
    await loadDriveTab();
  };

  // ─── Notion sync ─────────────────────────────────────────────────────────────

  const syncNotionRowInternal = async (row: NotionTableRow): Promise<void> => {
    if (row.status === "orphaned") return;
    setNotionSyncingIds(prev => { const s = new Set(prev); s.add(row.notionPageId); return s; });
    try {
      await fetch("/api/admin/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: row.notionPageId,
          title: row.title,
          lastEdited: row.lastEdited,
          url: row.url,
        }),
      });
    } finally {
      setNotionSyncingIds(prev => { const s = new Set(prev); s.delete(row.notionPageId); return s; });
    }
  };

  const syncNotionRow = async (row: NotionTableRow) => {
    await syncNotionRowInternal(row);
    await loadNotionTab();
  };

  const syncNotionSelected = async () => {
    const toSync = notionRows.filter(r =>
      notionSelected.has(r.notionPageId) && r.status !== "orphaned"
    );
    if (toSync.length === 0) return;
    for (let i = 0; i < toSync.length; i++) {
      setNotionSyncProgress({ current: i + 1, total: toSync.length });
      await syncNotionRowInternal(toSync[i]);
    }
    setNotionSyncProgress(null);
    setNotionSelected(new Set());
    await loadNotionTab();
  };

  const syncAllNotion = async () => {
    const toSync = notionRows.filter(r => r.status === "new" || r.status === "update");
    if (toSync.length === 0) return;
    setNotionSyncProgress({ current: 0, total: toSync.length });
    for (let i = 0; i < toSync.length; i++) {
      await syncNotionRowInternal(toSync[i]);
      setNotionSyncProgress({ current: i + 1, total: toSync.length });
    }
    setNotionSyncProgress(null);
    await loadNotionTab();
  };

  // ─── Web sources ─────────────────────────────────────────────────────────────

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
      else { setWebUrl(""); setWebCategory("general"); setWebPriority(50); fetchWebSources(); }
    } catch { setWebError("Помилка мережі"); }
    finally { setAddingWebSource(false); }
  };

  const handleRefreshWebSource = async (id: string) => {
    setRefreshingId(id);
    try { await fetch(`/api/admin/websites/${id}`, { method: "POST" }); fetchWebSources(); }
    catch { console.error("Failed to refresh"); }
    finally { setRefreshingId(null); }
  };

  const handleDeleteWebSource = async (id: string) => {
    if (!confirm("Видалити це веб-джерело?")) return;
    const res = await fetch(`/api/admin/websites/${id}`, { method: "DELETE" });
    if (res.ok) { setWebSources(prev => prev.filter(s => s.id !== id)); setWebSelected(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const refreshWebSelected = async () => {
    for (const id of Array.from(webSelected)) {
      setRefreshingId(id);
      try { await fetch(`/api/admin/websites/${id}`, { method: "POST" }); } catch { /**/ }
    }
    setRefreshingId(null);
    await fetchWebSources();
  };

  // ─── Upload ──────────────────────────────────────────────────────────────────

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
        newResults.push(res.ok ? data : { filename: file.name, category: "", priority: 0, tokenCount: 0, documentId: "", error: data.error });
      } catch {
        newResults.push({ filename: file.name, category: "", priority: 0, tokenCount: 0, documentId: "", error: "Помилка мережі" });
      }
    }
    setUploadResults(prev => [...newResults, ...prev]);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Reload files table
    setFileDocsLoaded(false);
    loadFilesTab();
  };

  // ─── Settings ────────────────────────────────────────────────────────────────

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (res.ok) setAiProvider(data.provider);
      else setSettingsError(data.error ?? "Не вдалося завантажити налаштування");
    } catch { setSettingsError("Помилка мережі"); }
    finally { setSettingsLoading(false); }
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
      if (res.ok) { setAiProvider(data.provider); setSettingsSuccess(true); setTimeout(() => setSettingsSuccess(false), 3000); }
      else setSettingsError(data.error ?? "Не вдалося зберегти");
    } catch { setSettingsError("Помилка мережі"); }
    finally { setSettingsSaving(false); }
  };

  // ─── Telegram ────────────────────────────────────────────────────────────────

  const loadTelegramUsers = async () => {
    setTelegramUsersLoading(true);
    try {
      const res = await fetch("/api/admin/settings/telegram");
      const data = await res.json();
      if (res.ok) setTelegramUsers(data.allowedUsers);
      else setTelegramUsersError(data.error ?? "Не вдалося завантажити список");
    } catch { setTelegramUsersError("Помилка мережі"); }
    finally { setTelegramUsersLoading(false); }
  };

  const saveTelegramUsers = async (users: string[]) => {
    setTelegramUsersSaving(true);
    try {
      const res = await fetch("/api/admin/settings/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedUsers: users }),
      });
      const data = await res.json();
      if (res.ok) setTelegramUsers(data.allowedUsers);
      else setTelegramUsersError(data.error ?? "Не вдалося зберегти");
    } catch { setTelegramUsersError("Помилка мережі"); }
    finally { setTelegramUsersSaving(false); }
  };

  const addTelegramUser = async () => {
    const value = telegramUserInput.trim();
    if (!value) return;
    const current = telegramUsers ?? [];
    const normalized = /^\d+$/.test(value) ? value : value.startsWith("@") ? value : `@${value}`;
    if (current.includes(normalized)) { setTelegramUserInput(""); return; }
    setTelegramUserInput("");
    await saveTelegramUsers([...current, normalized]);
  };

  const removeTelegramUser = async (user: string) => {
    const current = telegramUsers ?? [];
    await saveTelegramUsers(current.filter(u => u !== user));
  };

  // ─── Filter / Sort helpers ────────────────────────────────────────────────────

  const toggleSort = (setSort: React.Dispatch<React.SetStateAction<SortConfig>>, key: string) => {
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  };

  function SortTh({ label, sortKey, current, onToggle }: { label: string; sortKey: string; current: SortConfig; onToggle: () => void }) {
    const active = current.key === sortKey;
    return (
      <th
        onClick={onToggle}
        className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
      >
        {label}
        <span className={`ml-1 ${active ? "text-[#ff8319]" : "text-gray-300"}`}>
          {active ? (current.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </th>
    );
  }

  function CategorySelect({ value, documentId, onChange }: {
    value: DocumentCategory | undefined;
    documentId: string | undefined;
    onChange: (cat: DocumentCategory) => void;
  }) {
    if (!documentId) return <span className="text-gray-300 text-xs italic">auto</span>;
    return (
      <select
        value={value ?? "general"}
        onChange={e => onChange(e.target.value as DocumentCategory)}
        onClick={e => e.stopPropagation()}
        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]"
      >
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }

  // Toolbar
  function TableToolbar({
    search, onSearch,
    catFilter, onCatFilter,
    statusFilter, onStatusFilter, statusOptions,
    onRefresh, refreshLoading,
    selectedCount,
    onDelete, onSync,
    syncProgress,
    extraLeft,
  }: {
    search: string; onSearch: (v: string) => void;
    catFilter: string; onCatFilter: (v: string) => void;
    statusFilter?: string; onStatusFilter?: (v: string) => void;
    statusOptions?: { value: string; label: string }[];
    onRefresh: () => void; refreshLoading: boolean;
    selectedCount: number;
    onDelete?: () => void; onSync?: () => void;
    syncProgress?: { current: number; total: number } | null;
    extraLeft?: React.ReactNode;
  }) {
    return (
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z" />
            </svg>
            <input
              type="text" value={search} onChange={e => onSearch(e.target.value)}
              placeholder="Пошук..."
              className="pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-48 focus:outline-none focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]"
            />
          </div>

          {/* Category filter */}
          <select value={catFilter} onChange={e => onCatFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]">
            <option value="">Всі категорії</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Status filter */}
          {statusOptions && onStatusFilter && (
            <select value={statusFilter ?? ""} onChange={e => onStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]">
              <option value="">Всі статуси</option>
              {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}

          {extraLeft}

          <div className="flex-1" />

          {/* Batch actions */}
          {selectedCount > 0 && onDelete && (
            <button onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Видалити ({selectedCount})
            </button>
          )}
          {selectedCount > 0 && onSync && (
            <button onClick={onSync}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Синхронізувати ({selectedCount})
            </button>
          )}

          {/* Refresh */}
          <button onClick={onRefresh} disabled={refreshLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
            <svg className={`w-3.5 h-3.5 ${refreshLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Оновити
          </button>
        </div>

        {/* Progress bar */}
        {syncProgress && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Синхронізація...</span>
              <span>{syncProgress.current} / {syncProgress.total}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1">
              <div className="bg-[#ff8319] h-1 rounded-full transition-all"
                style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Auth guard ───────────────────────────────────────────────────────────────

  if (status === "loading" || !session?.user?.isAdmin) {
    return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ff8319]" /></div>;
  }

  // ─── Computed (filtered + sorted) rows ───────────────────────────────────────

  const filteredDriveRows = applySort(
    driveRows.filter(r => {
      if (driveSearch && !r.name.toLowerCase().includes(driveSearch.toLowerCase())) return false;
      if (driveCatFilter && r.category !== driveCatFilter) return false;
      if (driveStatusFilter && r.status !== driveStatusFilter) return false;
      return true;
    }) as Record<string, unknown>[],
    driveSort
  ) as unknown as DriveTableRow[];

  const filteredNotionRows = applySort(
    notionRows.filter(r => {
      if (notionSearch && !r.title.toLowerCase().includes(notionSearch.toLowerCase())) return false;
      if (notionCatFilter && r.category !== notionCatFilter) return false;
      if (notionStatusFilter && r.status !== notionStatusFilter) return false;
      return true;
    }) as Record<string, unknown>[],
    notionSort
  ) as unknown as NotionTableRow[];

  const filteredFileDocs = applySort(
    fileDocs.filter(r => {
      if (fileSearch && !r.filename.toLowerCase().includes(fileSearch.toLowerCase())) return false;
      if (fileCatFilter && r.category !== fileCatFilter) return false;
      return true;
    }) as Record<string, unknown>[],
    fileSort
  ) as unknown as DocumentRow[];

  const filteredWebSources = applySort(
    webSources.filter(r => {
      if (webSearch && !(r.filename + r.sourceUrl).toLowerCase().includes(webSearch.toLowerCase())) return false;
      if (webCatFilter && r.category !== webCatFilter) return false;
      if (webStatusFilter) {
        const hasError = !!r.fetchError;
        if (webStatusFilter === "error" && !hasError) return false;
        if (webStatusFilter === "ok" && hasError) return false;
      }
      return true;
    }) as Record<string, unknown>[],
    webSort
  ) as unknown as WebSource[];

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-gray-700 text-sm">← Назад до чату</Link>
            <h1 className="text-xl font-semibold text-gray-900">Джерела знань</h1>
          </div>
          <Link href="/admin/costs" className="text-sm text-[#ff8319] hover:text-[#e6730d]">Витрати</Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Tab: Files ── */}
        {activeTab === "files" && (
          <div className="space-y-6">
            {/* Upload area */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Завантажити файли</h2>
              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${dragOver ? "border-[#ff8319] bg-orange-50" : "border-gray-200 hover:border-gray-300"}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
              >
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-[#ff8319]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">Перетягніть файли або натисніть для вибору</p>
                <p className="text-xs text-gray-400 mb-4">PDF, DOCX, DOC, TXT, MD — до 10 МБ</p>
                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" multiple onChange={e => e.target.files && uploadFiles(e.target.files)} className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="bg-[#ff8319] text-white rounded-xl px-5 py-2 text-sm font-medium hover:bg-[#e6730d] disabled:opacity-50 transition-colors">
                  {uploading ? "Завантаження..." : "Вибрати файли"}
                </button>
              </div>
              {uploadResults.length > 0 && (
                <div className="mt-4 space-y-2">
                  {uploadResults.slice(0, 5).map((r, i) => (
                    <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${r.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                      <span>{r.error ? "✕" : "✓"}</span>
                      <span className="font-medium truncate">{r.filename}</span>
                      {!r.error && <span className="text-xs text-green-600 ml-auto">{r.tokenCount.toLocaleString()} tokens</span>}
                      {r.error && <span className="text-xs ml-auto">{r.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Files table */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Завантажені файли</h2>
                  {!fileTableVisible && <p className="text-sm text-gray-400 mt-0.5">{fileDocs.length} файл{fileDocs.length === 1 ? "" : "ів"}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {fileDocsLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#ff8319]" />}
                  <button onClick={() => setFileTableVisible(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                    {fileTableVisible ? "Сховати" : "Переглянути"}
                  </button>
                </div>
              </div>

              {fileTableVisible && (
              <><TableToolbar
                search={fileSearch} onSearch={setFileSearch}
                catFilter={fileCatFilter} onCatFilter={setFileCatFilter}
                onRefresh={() => { setFileDocsLoaded(false); loadFilesTab(); }} refreshLoading={fileDocsLoading}
                selectedCount={fileSelected.size}
                onDelete={deleteFileSelected}
              />

              {fileDocsLoading ? (
                <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" /></div>
              ) : filteredFileDocs.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  {fileDocs.length === 0 ? "Файли ще не завантажено" : "Нічого не знайдено"}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2.5 w-8">
                          <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                            checked={filteredFileDocs.length > 0 && filteredFileDocs.every(r => fileSelected.has(r.id))}
                            onChange={e => setFileSelected(e.target.checked ? new Set(filteredFileDocs.map(r => r.id)) : new Set())}
                          />
                        </th>
                        <SortTh label="Назва" sortKey="filename" current={fileSort} onToggle={() => toggleSort(setFileSort, "filename")} />
                        <SortTh label="Категорія" sortKey="category" current={fileSort} onToggle={() => toggleSort(setFileSort, "category")} />
                        <SortTh label="Завантажено" sortKey="uploadedAt" current={fileSort} onToggle={() => toggleSort(setFileSort, "uploadedAt")} />
                        <SortTh label="Токени" sortKey="tokenCount" current={fileSort} onToggle={() => toggleSort(setFileSort, "tokenCount")} />
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Дії</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredFileDocs.map(doc => (
                        <tr key={doc.id} className={`hover:bg-gray-50 transition-colors ${fileSelected.has(doc.id) ? "bg-orange-50/40" : ""}`}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                              checked={fileSelected.has(doc.id)}
                              onChange={e => setFileSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(doc.id) : s.delete(doc.id); return s; })}
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-xs truncate">{doc.filename}</td>
                          <td className="px-3 py-2.5">
                            <CategorySelect value={doc.category} documentId={doc.id} onChange={cat => updateFileCategory(doc.id, cat)} />
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(doc.uploadedAt)}</td>
                          <td className="px-3 py-2.5 text-gray-500">{doc.tokenCount?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={async () => { if (!confirm("Видалити файл?")) return; const ok = await bulkDelete([doc.id]); if (ok) loadFilesTab(); }}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors">
                              Видалити
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </>)}
            </div>
          </div>
        )}

        {/* ── Tab: Google Drive ── */}
        {activeTab === "drive" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Google Drive</h2>
                <p className="text-sm text-gray-400 mt-0.5">Файли з налаштованої папки Drive</p>
              </div>
              <div className="flex items-center gap-3">
                {driveLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#ff8319]" />}
                {driveLoaded && (
                  <span className="text-sm text-gray-400">
                    {driveRows.filter(r => r.status === "new").length} нових · {driveRows.filter(r => r.status === "update").length} оновлених · {driveRows.filter(r => r.status === "unchanged").length} актуальних
                  </span>
                )}
                <button onClick={syncAllDrive} disabled={driveLoading || driveSyncProgress !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Синхронізувати
                </button>
                <button onClick={() => setDriveTableVisible(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                  {driveTableVisible ? "Сховати" : "Переглянути"}
                </button>
              </div>
            </div>

            {driveSyncProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Синхронізація {driveSyncProgress.current} / {driveSyncProgress.total}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(driveSyncProgress.current / driveSyncProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            {driveError && (
              <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{driveError}</div>
            )}

            {driveTableVisible && (
            <><TableToolbar
              search={driveSearch} onSearch={setDriveSearch}
              catFilter={driveCatFilter} onCatFilter={setDriveCatFilter}
              statusFilter={driveStatusFilter} onStatusFilter={setDriveStatusFilter}
              statusOptions={[
                { value: "new", label: "Новий" },
                { value: "update", label: "Оновлено" },
                { value: "unchanged", label: "Актуальний" },
                { value: "orphaned", label: "Видалено з Drive" },
              ]}
              onRefresh={loadDriveTab} refreshLoading={driveLoading}
              selectedCount={driveSelected.size}
              onDelete={deleteDriveSelected}
              onSync={syncDriveSelected}
            />

            {driveLoading ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" /></div>
            ) : filteredDriveRows.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                {driveRows.length === 0 ? "Файли не знайдено" : "Нічого не знайдено за фільтром"}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                          checked={filteredDriveRows.length > 0 && filteredDriveRows.every(r => driveSelected.has(r.driveFileId))}
                          onChange={e => setDriveSelected(e.target.checked ? new Set(filteredDriveRows.map(r => r.driveFileId)) : new Set())}
                        />
                      </th>
                      <SortTh label="Назва" sortKey="name" current={driveSort} onToggle={() => toggleSort(setDriveSort, "name")} />
                      <SortTh label="Категорія" sortKey="category" current={driveSort} onToggle={() => toggleSort(setDriveSort, "category")} />
                      <SortTh label="Змінено" sortKey="modifiedTime" current={driveSort} onToggle={() => toggleSort(setDriveSort, "modifiedTime")} />
                      <SortTh label="Розмір" sortKey="size" current={driveSort} onToggle={() => toggleSort(setDriveSort, "size")} />
                      <SortTh label="Токени" sortKey="tokenCount" current={driveSort} onToggle={() => toggleSort(setDriveSort, "tokenCount")} />
                      <SortTh label="Статус" sortKey="status" current={driveSort} onToggle={() => toggleSort(setDriveSort, "status")} />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Дії</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredDriveRows.map(row => {
                      const isSyncing = driveSyncingIds.has(row.driveFileId);
                      return (
                        <tr key={row.driveFileId} className={`hover:bg-gray-50 transition-colors ${driveSelected.has(row.driveFileId) ? "bg-orange-50/40" : ""}`}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                              checked={driveSelected.has(row.driveFileId)}
                              onChange={e => setDriveSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(row.driveFileId) : s.delete(row.driveFileId); return s; })}
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-xs">
                            <span className="truncate block">{row.name}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <CategorySelect value={row.category} documentId={row.documentId}
                              onChange={cat => updateDriveCategory(row, cat)} />
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                            {row.modifiedTime ? new Date(row.modifiedTime).toLocaleDateString("uk-UA") : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{formatSize(row.size)}</td>
                          <td className="px-3 py-2.5 text-gray-500">{row.tokenCount?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              {row.status !== "orphaned" && (
                                <button
                                  onClick={() => syncDriveRow(row)}
                                  disabled={isSyncing}
                                  className={`text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${
                                    row.status === "new" || row.status === "update"
                                      ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                  }`}
                                >
                                  {isSyncing ? "..." : row.status === "new" ? "Синхр." : row.status === "update" ? "Оновити" : "Ре-синхр."}
                                </button>
                              )}
                              {row.documentId && (
                                <button
                                  onClick={async () => { if (!confirm("Видалити з бази знань?")) return; const ok = await bulkDelete([row.documentId!]); if (ok) loadDriveTab(); }}
                                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                                >
                                  Видалити
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>)}
          </div>
        )}

        {/* ── Tab: Web Sources ── */}
        {activeTab === "web" && (
          <div className="space-y-6">
            {/* Add web source form */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Додати веб-джерело</h2>
              <form onSubmit={handleAddWebSource}>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">URL</label>
                    <input type="url" value={webUrl} onChange={e => setWebUrl(e.target.value)} placeholder="https://example.com/page"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]" required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Категорія</label>
                    <select value={webCategory} onChange={e => setWebCategory(e.target.value as DocumentCategory)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Пріоритет (0–100)</label>
                    <input type="number" min={0} max={100} value={webPriority} onChange={e => setWebPriority(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]" />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input type="checkbox" id="crawlLinks" checked={crawlLinks} onChange={e => setCrawlLinks(e.target.checked)} className="w-4 h-4 accent-[#ff8319]" />
                  <label htmlFor="crawlLinks" className="text-sm text-gray-700">Сканувати всі сторінки сайту</label>
                </div>
                {webError && <p className="mt-2 text-sm text-red-600">{webError}</p>}
                <div className="mt-3">
                  <button type="submit" disabled={addingWebSource || !webUrl.trim()}
                    className="bg-[#ff8319] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#e6730d] disabled:opacity-50 transition-colors">
                    {addingWebSource ? "Додавання..." : "Додати"}
                  </button>
                </div>
              </form>
            </div>

            {/* Web sources table */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Веб-джерела</h2>
                  {!webTableVisible && <p className="text-sm text-gray-400 mt-0.5">{webSources.length} джерел</p>}
                </div>
                <div className="flex items-center gap-2">
                  {loadingWebSources && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#ff8319]" />}
                  <button onClick={() => setWebTableVisible(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                    {webTableVisible ? "Сховати" : "Переглянути"}
                  </button>
                </div>
              </div>

              {webTableVisible && (
              <><TableToolbar
                search={webSearch} onSearch={setWebSearch}
                catFilter={webCatFilter} onCatFilter={setWebCatFilter}
                statusFilter={webStatusFilter} onStatusFilter={setWebStatusFilter}
                statusOptions={[{ value: "ok", label: "ОК" }, { value: "error", label: "Помилка" }]}
                onRefresh={fetchWebSources} refreshLoading={loadingWebSources}
                selectedCount={webSelected.size}
                onDelete={deleteWebSelected}
                onSync={webSelected.size > 0 ? refreshWebSelected : undefined}
              />

              {loadingWebSources ? (
                <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" /></div>
              ) : filteredWebSources.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  {webSources.length === 0 ? "Веб-джерела ще не додано" : "Нічого не знайдено"}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2.5 w-8">
                          <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                            checked={filteredWebSources.length > 0 && filteredWebSources.every(r => webSelected.has(r.id))}
                            onChange={e => setWebSelected(e.target.checked ? new Set(filteredWebSources.map(r => r.id)) : new Set())}
                          />
                        </th>
                        <SortTh label="Назва / URL" sortKey="filename" current={webSort} onToggle={() => toggleSort(setWebSort, "filename")} />
                        <SortTh label="Категорія" sortKey="category" current={webSort} onToggle={() => toggleSort(setWebSort, "category")} />
                        <SortTh label="Оновлено" sortKey="lastFetched" current={webSort} onToggle={() => toggleSort(setWebSort, "lastFetched")} />
                        <SortTh label="Токени" sortKey="tokenCount" current={webSort} onToggle={() => toggleSort(setWebSort, "tokenCount")} />
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Статус</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Дії</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredWebSources.map(src => (
                        <tr key={src.id} className={`hover:bg-gray-50 transition-colors ${webSelected.has(src.id) ? "bg-orange-50/40" : ""}`}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                              checked={webSelected.has(src.id)}
                              onChange={e => setWebSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(src.id) : s.delete(src.id); return s; })}
                            />
                          </td>
                          <td className="px-3 py-2.5 max-w-xs">
                            <p className="font-medium text-gray-900 truncate">{src.filename}</p>
                            <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#ff8319] hover:underline truncate block">{src.sourceUrl}</a>
                          </td>
                          <td className="px-3 py-2.5">
                            <CategorySelect value={src.category} documentId={src.id} onChange={cat => updateWebCategory(src.id, cat)} />
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">{formatDate(src.lastFetched)}</td>
                          <td className="px-3 py-2.5 text-gray-500">{src.tokenCount?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-2.5">
                            {src.fetchError
                              ? <span title={src.fetchError}><StatusBadge status="error" /></span>
                              : <StatusBadge status="ok" />}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleRefreshWebSource(src.id)} disabled={refreshingId === src.id}
                                className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
                                {refreshingId === src.id ? "..." : "Оновити"}
                              </button>
                              <button onClick={() => handleDeleteWebSource(src.id)}
                                className="text-xs text-red-400 hover:text-red-600 transition-colors">Видалити</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </>)}
            </div>
          </div>
        )}

        {/* ── Tab: Notion ── */}
        {activeTab === "notion" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Notion</h2>
                <p className="text-sm text-gray-400 mt-0.5">Сторінки з вашого Notion workspace</p>
              </div>
              <div className="flex items-center gap-3">
                {notionLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#ff8319]" />}
                {notionLoaded && (
                  <span className="text-sm text-gray-400">
                    {notionRows.filter(r => r.status === "new").length} нових · {notionRows.filter(r => r.status === "update").length} оновлених · {notionRows.filter(r => r.status === "unchanged").length} актуальних
                  </span>
                )}
                <button onClick={syncAllNotion} disabled={notionLoading || notionSyncProgress !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Синхронізувати
                </button>
                <button onClick={() => setNotionTableVisible(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                  {notionTableVisible ? "Сховати" : "Переглянути"}
                </button>
              </div>
            </div>

            {notionSyncProgress && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Синхронізація {notionSyncProgress.current} / {notionSyncProgress.total}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(notionSyncProgress.current / notionSyncProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            {notionError && (
              <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{notionError}</div>
            )}

            {notionTableVisible && (
            <><TableToolbar
              search={notionSearch} onSearch={setNotionSearch}
              catFilter={notionCatFilter} onCatFilter={setNotionCatFilter}
              statusFilter={notionStatusFilter} onStatusFilter={setNotionStatusFilter}
              statusOptions={[
                { value: "new", label: "Новий" },
                { value: "update", label: "Оновлено" },
                { value: "unchanged", label: "Актуальний" },
                { value: "orphaned", label: "Видалено з Notion" },
              ]}
              onRefresh={loadNotionTab} refreshLoading={notionLoading}
              selectedCount={notionSelected.size}
              onDelete={deleteNotionSelected}
              onSync={syncNotionSelected}
            />

            {notionLoading ? (
              <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" /></div>
            ) : filteredNotionRows.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                {notionRows.length === 0 ? "Сторінки не знайдено. Переконайтесь, що ви надали доступ до сторінок у Notion інтеграції." : "Нічого не знайдено за фільтром"}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                          checked={filteredNotionRows.length > 0 && filteredNotionRows.every(r => notionSelected.has(r.notionPageId))}
                          onChange={e => setNotionSelected(e.target.checked ? new Set(filteredNotionRows.map(r => r.notionPageId)) : new Set())}
                        />
                      </th>
                      <SortTh label="Назва" sortKey="title" current={notionSort} onToggle={() => toggleSort(setNotionSort, "title")} />
                      <SortTh label="Категорія" sortKey="category" current={notionSort} onToggle={() => toggleSort(setNotionSort, "category")} />
                      <SortTh label="Редаговано" sortKey="lastEdited" current={notionSort} onToggle={() => toggleSort(setNotionSort, "lastEdited")} />
                      <SortTh label="Токени" sortKey="tokenCount" current={notionSort} onToggle={() => toggleSort(setNotionSort, "tokenCount")} />
                      <SortTh label="Статус" sortKey="status" current={notionSort} onToggle={() => toggleSort(setNotionSort, "status")} />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Дії</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredNotionRows.map(row => {
                      const isSyncing = notionSyncingIds.has(row.notionPageId);
                      return (
                        <tr key={row.notionPageId} className={`hover:bg-gray-50 transition-colors ${notionSelected.has(row.notionPageId) ? "bg-orange-50/40" : ""}`}>
                          <td className="px-3 py-2.5">
                            <input type="checkbox" className="w-4 h-4 accent-[#ff8319]"
                              checked={notionSelected.has(row.notionPageId)}
                              onChange={e => setNotionSelected(prev => { const s = new Set(prev); e.target.checked ? s.add(row.notionPageId) : s.delete(row.notionPageId); return s; })}
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium text-gray-900 max-w-xs">
                            {row.url ? (
                              <a href={row.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="hover:text-[#ff8319] hover:underline truncate block">
                                {row.title}
                              </a>
                            ) : (
                              <span className="truncate block">{row.title}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <CategorySelect value={row.category} documentId={row.documentId}
                              onChange={cat => updateNotionCategory(row, cat)} />
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                            {row.lastEdited ? new Date(row.lastEdited).toLocaleDateString("uk-UA") : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-gray-500">{row.tokenCount?.toLocaleString() ?? "—"}</td>
                          <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              {row.status !== "orphaned" && (
                                <button
                                  onClick={() => syncNotionRow(row)}
                                  disabled={isSyncing}
                                  className={`text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${
                                    row.status === "new" || row.status === "update"
                                      ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                  }`}
                                >
                                  {isSyncing ? "..." : row.status === "new" ? "Синхр." : row.status === "update" ? "Оновити" : "Ре-синхр."}
                                </button>
                              )}
                              {row.documentId && (
                                <button
                                  onClick={async () => { if (!confirm("Видалити з бази знань?")) return; const ok = await bulkDelete([row.documentId!]); if (ok) loadNotionTab(); }}
                                  className="text-xs text-red-400 hover:text-red-600 transition-colors"
                                >
                                  Видалити
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            </>)}
          </div>
        )}

        {/* ── Tab: Settings ── */}
        {activeTab === "settings" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">AI Модель</h2>
              <p className="text-sm text-gray-400 mt-0.5">Оберіть AI-провайдера для відповідей асистента</p>
            </div>

            {settingsLoading && <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#ff8319]" /></div>}
            {settingsError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{settingsError}</div>}
            {settingsSuccess && <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 mb-4">Налаштування збережено</div>}

            {aiProvider !== null && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => switchProvider("claude")} disabled={settingsSaving}
                  className={`text-left p-5 rounded-xl border-2 transition-all disabled:opacity-50 ${aiProvider === "claude" ? "border-[#ff8319] bg-orange-50" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900">Claude Haiku</span>
                    {aiProvider === "claude" && <span className="text-xs font-medium bg-[#ff8319] text-white px-2 py-0.5 rounded-full">Активний</span>}
                  </div>
                  <p className="text-xs text-gray-500 mb-1">Anthropic</p>
                  <div className="space-y-0.5 text-xs text-gray-400">
                    <p>Вхідні: $0.25 / 1M токенів</p>
                    <p>Вихідні: $1.25 / 1M токенів</p>
                    <p className="text-green-600">+ Промпт-кешування</p>
                  </div>
                </button>
                <button onClick={() => switchProvider("gemini")} disabled={settingsSaving}
                  className={`text-left p-5 rounded-xl border-2 transition-all disabled:opacity-50 ${aiProvider === "gemini" ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-900">Gemini 2.5 Flash</span>
                    {aiProvider === "gemini" && <span className="text-xs font-medium bg-blue-500 text-white px-2 py-0.5 rounded-full">Активний</span>}
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

            {/* Telegram whitelist */}
            <div className="mt-8 pt-8 border-t border-gray-100">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="w-4 h-4 text-[#229ED9]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.01 9.47c-.148.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L6.166 14.77l-2.95-.924c-.64-.203-.654-.64.136-.948l11.52-4.44c.534-.194 1.001.13.69.79z"/>
                  </svg>
                  Telegram — дозволені користувачі
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">Порожній список — бот доступний усім. Додайте @username або числовий ID.</p>
              </div>
              {telegramUsersLoading && <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#ff8319]" /></div>}
              {telegramUsersError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{telegramUsersError}</div>}
              {telegramUsers !== null && (
                <>
                  <div className="flex gap-2 mb-4">
                    <input type="text" value={telegramUserInput} onChange={e => setTelegramUserInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addTelegramUser()}
                      placeholder="@username або 123456789"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-[#ff8319] focus:border-[#ff8319]" />
                    <button onClick={addTelegramUser} disabled={telegramUsersSaving || !telegramUserInput.trim()}
                      className="px-4 py-2 bg-[#ff8319] text-white rounded-lg text-sm font-medium hover:bg-[#e6730d] disabled:opacity-50 transition-colors">
                      {telegramUsersSaving ? "..." : "Додати"}
                    </button>
                  </div>
                  {telegramUsers.length === 0 ? (
                    <div className="text-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                      <p className="text-sm text-gray-400">Бот відкритий для всіх користувачів</p>
                      <p className="text-xs text-gray-400 mt-1">Додайте користувачів вище, щоб обмежити доступ</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {telegramUsers.map(user => (
                        <div key={user} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[#229ED9] flex items-center justify-center text-white text-xs font-medium">
                              {/^\d+$/.test(user) ? "#" : user[1]?.toUpperCase() ?? "?"}
                            </div>
                            <span className="text-sm text-gray-800 font-medium">{user}</span>
                          </div>
                          <button onClick={() => removeTelegramUser(user)} disabled={telegramUsersSaving}
                            className="text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors p-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
