"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Document {
  id: string;
  filename: string;
  category: string;
  priority: number;
  tokenCount: number;
  usageCount: number;
  uploadedAt: { seconds: number };
  lastUsed?: { seconds: number };
}

export default function DocumentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.isAdmin) {
      fetchDocuments();
    }
  }, [status, session]);

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

  async function fetchDocuments() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/documents");
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      console.error("Failed to fetch documents");
    } finally {
      setLoading(false);
    }
  }

  async function deleteDocument(id: string, filename: string) {
    if (!confirm(`Видалити "${filename}"? Цю дію не можна скасувати.`)) return;
    setDeleting(id);
    try {
      await fetch(`/api/admin/documents/${id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch {
      alert("Не вдалося видалити документ");
    } finally {
      setDeleting(null);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Видалити ${selected.size} документ${selected.size === 1 ? "" : selected.size < 5 ? "и" : "ів"}? Цю дію не можна скасувати.`)) return;
    setBatchDeleting(true);
    try {
      const ids = Array.from(selected);
      const res = await fetch("/api/admin/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => !selected.has(d.id)));
        setSelected(new Set());
      } else {
        alert("Не вдалося видалити документи");
      }
    } catch {
      alert("Помилка мережі");
    } finally {
      setBatchDeleting(false);
    }
  }

  const allSelected = documents.length > 0 && selected.size === documents.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(documents.map((d) => d.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalTokens = documents.reduce((sum, d) => sum + d.tokenCount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-gray-700 text-sm">
              ← Адмін
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">
              Керування документами
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {selected.size > 0 && (
              <button
                onClick={deleteSelected}
                disabled={batchDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {batchDeleting ? (
                  <>
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                    Видалення...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Видалити вибрані ({selected.size})
                  </>
                )}
              </button>
            )}
            <div className="text-sm text-gray-500">
              {documents.length} документів · ~{totalTokens.toLocaleString()} токенів
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#ff8319]" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 mb-4">Документи ще не завантажено.</p>
            <Link
              href="/admin"
              className="bg-[#ff8319] text-white rounded-xl px-6 py-2.5 font-medium hover:bg-[#e6730d] transition-colors"
            >
              Завантажити документи
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 accent-[#ff8319] cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Назва файлу
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Категорія
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Пріоритет
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Токени
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Використання
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Завантажено
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className={`hover:bg-gray-50 transition-colors ${selected.has(doc.id) ? "bg-orange-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleOne(doc.id)}
                        className="w-4 h-4 rounded border-gray-300 accent-[#ff8319] cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      {doc.filename}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-orange-50 text-[#cc6b14] capitalize">
                        {doc.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {doc.priority}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {doc.tokenCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {doc.usageCount}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(doc.uploadedAt.seconds * 1000).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => deleteDocument(doc.id, doc.filename)}
                        disabled={deleting === doc.id || batchDeleting}
                        className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50 transition-colors"
                      >
                        {deleting === doc.id ? "Видалення..." : "Видалити"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
