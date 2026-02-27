"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DayMetrics {
  date: string;
  queryCount: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  estimatedCost: number;
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
      queries: acc.queries + m.queryCount,
      cost: acc.cost + m.estimatedCost,
      cacheRead: acc.cacheRead + m.cacheReadTokens,
      cacheCreation: acc.cacheCreation + m.cacheCreationTokens,
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
    }),
    {
      queries: 0,
      cost: 0,
      cacheRead: 0,
      cacheCreation: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  );

  const cacheHitRate =
    totals.queries > 0
      ? Math.round((totals.cacheRead / (totals.cacheRead + totals.cacheCreation || 1)) * 100)
      : 0;

  const avgCostPerQuery =
    totals.queries > 0 ? totals.cost / totals.queries : 0;

  const today = metrics.find(
    (m) => m.date === new Date().toISOString().split("T")[0]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-gray-500 hover:text-gray-700 text-sm">
              ← Admin
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">
              Cost Dashboard
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Today's Cost"
            value={`$${(today?.estimatedCost ?? 0).toFixed(4)}`}
            sub={`${today?.queryCount ?? 0} queries`}
          />
          <StatCard
            label="This Period Cost"
            value={`$${totals.cost.toFixed(3)}`}
            sub={`${metrics.length} days`}
          />
          <StatCard
            label="Cache Hit Rate"
            value={`${cacheHitRate}%`}
            sub="target: >60%"
            highlight={cacheHitRate >= 60}
          />
          <StatCard
            label="Avg Cost/Query"
            value={`$${avgCostPerQuery.toFixed(5)}`}
            sub={`${totals.queries} total queries`}
          />
        </div>

        {/* Token breakdown */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Token Usage Breakdown
          </h2>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {(totals.inputTokens / 1000).toFixed(1)}k
              </p>
              <p className="text-sm text-gray-500">Input tokens</p>
              <p className="text-xs text-gray-400">billed at $0.25/1M</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">
                {(totals.cacheRead / 1000).toFixed(1)}k
              </p>
              <p className="text-sm text-gray-500">Cache read tokens</p>
              <p className="text-xs text-gray-400">billed at $0.03/1M</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {(totals.outputTokens / 1000).toFixed(1)}k
              </p>
              <p className="text-sm text-gray-500">Output tokens</p>
              <p className="text-xs text-gray-400">billed at $1.25/1M</p>
            </div>
          </div>
        </div>

        {/* Daily breakdown table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : metrics.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            No usage data yet. Usage will appear here after the first chat.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">
                    Date
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Queries
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Cache Reads
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Output Tokens
                  </th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">
                    Est. Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {metrics.map((m) => (
                  <tr key={m.date} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-900">{m.date}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {m.queryCount}
                    </td>
                    <td className="px-4 py-3 text-right text-green-600">
                      {m.cacheReadTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {m.outputTokens.toLocaleString()}
                    </td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900">
                      ${m.estimatedCost.toFixed(4)}
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
      <p
        className={`text-2xl font-bold ${highlight ? "text-green-600" : "text-gray-900"}`}
      >
        {value}
      </p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  );
}
