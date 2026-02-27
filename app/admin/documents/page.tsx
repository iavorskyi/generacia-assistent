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

  useEffect(() => {
    if (status === "authenticated" && session?.user?.isAdmin) {
      fetchDocuments();
    }
  }, [status, session]);

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
    if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await fetch(`/api/admin/documents/${id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch {
      alert("Failed to delete document");
    } finally {
      setDeleting(null);
    }
  }

  const totalTokens = documents.reduce((sum, d) => sum + d.tokenCount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-gray-700 text-sm">
              ← Admin
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">
              Document Management
            </h1>
          </div>
          <div className="text-sm text-gray-500">
            {documents.length} documents · ~{totalTokens.toLocaleString()} total tokens
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 mb-4">No documents uploaded yet.</p>
            <Link
              href="/admin"
              className="bg-blue-600 text-white rounded-xl px-6 py-2.5 font-medium hover:bg-blue-700 transition-colors"
            >
              Upload Documents
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">
                    Filename
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Category
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Priority
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Tokens
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Uses
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Uploaded
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900 max-w-xs truncate">
                      {doc.filename}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 capitalize">
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
                        disabled={deleting === doc.id}
                        className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50"
                      >
                        {deleting === doc.id ? "Deleting..." : "Delete"}
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
