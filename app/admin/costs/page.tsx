"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DayMetrics {
  date: string;
  queryCount: number;
  // Totals
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  // Per-provider tokens
  claudeQueryCount: number;
  claudeInputTokens: number;
  claudeCacheCreationTokens: number;
  claudeCacheReadTokens: number;
  claudeOutputTokens: number;
  geminiQueryCount: number;
  geminiInputTokens: number;
  geminiOutputTokens: number;
  // Costs (recalculated server-side from tokens)
  claudeCost: number;
  geminiCost: number;
  calculatedCost: number;
}

export default function CostDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [metrics, setMetrics] = useState<DayMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.isAdmin) {
      fetchMetrics();
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

  async function fetchMetrics() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/costs");
      const data = await res.json();
      setMetrics(data.metrics || []);
    } finally {
      setLoading(false);
    }
  }

  // Aggregate totals
  const totals = metrics.reduce(
    (acc, m) => ({
      queries:              acc.queries              + m.queryCount,
      cost:                 acc.cost                 + m.calculatedCost,
      claudeCost:           acc.claudeCost           + m.claudeCost,
      geminiCost:           acc.geminiCost           + m.geminiCost,
      claudeQueries:        acc.claudeQueries        + m.claudeQueryCount,
      geminiQueries:        acc.geminiQueries        + m.geminiQueryCount,
      claudeInputTokens:    acc.claudeInputTokens    + m.claudeInputTokens,
      claudeOutputTokens:   acc.claudeOutputTokens   + m.claudeOutputTokens,
      claudeCacheRead:      acc.claudeCacheRead      + m.claudeCacheReadTokens,
      claudeCacheCreation:  acc.claudeCacheCreation  + m.claudeCacheCreationTokens,
      geminiInputTokens:    acc.geminiInputTokens    + m.geminiInputTokens,
      geminiOutputTokens:   acc.geminiOutputTokens   + m.geminiOutputTokens,
    }),
    {
      queries: 0, cost: 0,
      claudeCost: 0, geminiCost: 0,
      claudeQueries: 0, geminiQueries: 0,
      claudeInputTokens: 0, claudeOutputTokens: 0,
      claudeCacheRead: 0, claudeCacheCreation: 0,
      geminiInputTokens: 0, geminiOutputTokens: 0,
    }
  );

  const avgCostPerQuery = totals.queries > 0 ? totals.cost / totals.queries : 0;

  const claudeCacheHitRate =
    (totals.claudeCacheRead + totals.claudeCacheCreation) > 0
      ? Math.round((totals.claudeCacheRead / (totals.claudeCacheRead + totals.claudeCacheCreation)) * 100)
      : 0;

  const today = metrics.find(
    (m) => m.date === new Date().toISOString().split("T")[0]
  );

  const hasClaude = totals.claudeQueries > 0;
  const hasGemini = totals.geminiQueries > 0;
  const hasCache  = totals.claudeCacheRead > 0 || totals.claudeCacheCreation > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-gray-700 text-sm">
              ← Адмін
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">
              Панель витрат
            </h1>
          </div>
          <p className="text-xs text-gray-400">Вартість перерахована за актуальними тарифами</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Витрати сьогодні"
            value={`$${(today?.calculatedCost ?? 0).toFixed(4)}`}
            sub={`${today?.queryCount ?? 0} запитів`}
          />
          <StatCard
            label="Витрати за 30 днів"
            value={`$${totals.cost.toFixed(3)}`}
            sub={`${metrics.length} днів із даними`}
          />
          {hasCache && (
            <StatCard
              label="Кеш Claude"
              value={`${claudeCacheHitRate}%`}
              sub="ціль: >60%"
              highlight={claudeCacheHitRate >= 60}
            />
          )}
          <StatCard
            label="Середня вартість/запит"
            value={`$${avgCostPerQuery.toFixed(5)}`}
            sub={`${totals.queries} запитів всього`}
          />
        </div>

        {/* Per-provider cost breakdown */}
        {(hasClaude || hasGemini) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {hasClaude && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Claude Haiku 4.5</h2>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    {totals.claudeQueries} запитів
                  </span>
                </div>
                <p className="text-3xl font-bold text-gray-900 mb-4">${totals.claudeCost.toFixed(4)}</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Вхідні токени</span>
                    <span>{(totals.claudeInputTokens / 1000).toFixed(1)}k
                      <span className="text-xs text-gray-400 ml-1">@ $0.25/1M</span>
                    </span>
                  </div>
                  {hasCache && (
                    <>
                      <div className="flex justify-between text-gray-600">
                        <span>Запис у кеш</span>
                        <span>{(totals.claudeCacheCreation / 1000).toFixed(1)}k
                          <span className="text-xs text-gray-400 ml-1">@ $0.30/1M</span>
                        </span>
                      </div>
                      <div className="flex justify-between text-green-600">
                        <span>Читання з кешу</span>
                        <span>{(totals.claudeCacheRead / 1000).toFixed(1)}k
                          <span className="text-xs text-green-400 ml-1">@ $0.03/1M</span>
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>Вихідні токени</span>
                    <span>{(totals.claudeOutputTokens / 1000).toFixed(1)}k
                      <span className="text-xs text-gray-400 ml-1">@ $1.25/1M</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
            {hasGemini && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Gemini 2.5 Flash</h2>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    {totals.geminiQueries} запитів
                  </span>
                </div>
                <p className="text-3xl font-bold text-gray-900 mb-4">${totals.geminiCost.toFixed(4)}</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Вхідні токени</span>
                    <span>{(totals.geminiInputTokens / 1000).toFixed(1)}k
                      <span className="text-xs text-gray-400 ml-1">@ $0.15/1M</span>
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Вихідні токени</span>
                    <span>{(totals.geminiOutputTokens / 1000).toFixed(1)}k
                      <span className="text-xs text-gray-400 ml-1">@ $0.60/1M</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Daily breakdown table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : metrics.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            Даних про використання ще немає. Вони з&apos;являться після першого чату.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Дата</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Запити</th>
                  <th className="text-right px-4 py-3 font-medium text-purple-600">Claude</th>
                  <th className="text-right px-4 py-3 font-medium text-blue-600">Gemini</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Вартість</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {metrics.map((m) => (
                  <tr key={m.date} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-900">{m.date}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{m.queryCount}</td>
                    <td className="px-4 py-3 text-right text-purple-600">
                      {m.claudeQueryCount > 0
                        ? `${m.claudeQueryCount} · $${m.claudeCost.toFixed(4)}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-600">
                      {m.geminiQueryCount > 0
                        ? `${m.geminiQueryCount} · $${m.geminiCost.toFixed(4)}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900">
                      ${m.calculatedCost.toFixed(4)}
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

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? "text-green-600" : "text-gray-900"}`}>
        {value}
      </p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}
