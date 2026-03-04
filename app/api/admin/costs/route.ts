import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

// Current pricing (per 1M tokens)
const CLAUDE_INPUT_COST    = 0.25  / 1_000_000;
const CLAUDE_CACHE_WRITE   = 0.30  / 1_000_000;
const CLAUDE_CACHE_READ    = 0.03  / 1_000_000;
const CLAUDE_OUTPUT_COST   = 1.25  / 1_000_000;
const GEMINI_INPUT_COST    = 0.15  / 1_000_000;
const GEMINI_OUTPUT_COST   = 0.60  / 1_000_000;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();

  // Get last 30 days of metrics
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0];

  const snapshot = await db
    .collection("usageMetrics")
    .where("date", ">=", startDate)
    .orderBy("date", "desc")
    .get();

  const metrics = snapshot.docs.map((doc) => {
    const d = doc.data();

    // Per-provider token counts (present in new records)
    const claudeInputTokens         = (d.claudeInputTokens         as number) ?? 0;
    const claudeCacheCreationTokens = (d.claudeCacheCreationTokens as number) ?? 0;
    const claudeCacheReadTokens     = (d.claudeCacheReadTokens     as number) ?? 0;
    const claudeOutputTokens        = (d.claudeOutputTokens        as number) ?? 0;
    const geminiInputTokens         = (d.geminiInputTokens         as number) ?? 0;
    const geminiOutputTokens        = (d.geminiOutputTokens        as number) ?? 0;

    const hasProviderData = claudeInputTokens > 0 || geminiInputTokens > 0;

    let claudeCalcCost: number;
    let geminiCalcCost: number;

    if (hasProviderData) {
      // Recalculate from per-provider tokens with current pricing
      claudeCalcCost =
        claudeInputTokens         * CLAUDE_INPUT_COST  +
        claudeCacheCreationTokens * CLAUDE_CACHE_WRITE +
        claudeCacheReadTokens     * CLAUDE_CACHE_READ  +
        claudeOutputTokens        * CLAUDE_OUTPUT_COST;
      geminiCalcCost =
        geminiInputTokens  * GEMINI_INPUT_COST  +
        geminiOutputTokens * GEMINI_OUTPUT_COST;
    } else {
      // Legacy record — recalculate assuming Claude (original provider)
      const totalInput         = (d.inputTokens         as number) ?? 0;
      const totalCacheCreation = (d.cacheCreationTokens as number) ?? 0;
      const totalCacheRead     = (d.cacheReadTokens     as number) ?? 0;
      const totalOutput        = (d.outputTokens        as number) ?? 0;
      claudeCalcCost =
        totalInput         * CLAUDE_INPUT_COST  +
        totalCacheCreation * CLAUDE_CACHE_WRITE +
        totalCacheRead     * CLAUDE_CACHE_READ  +
        totalOutput        * CLAUDE_OUTPUT_COST;
      geminiCalcCost = 0;
    }

    return {
      date:                    (d.date         as string) ?? doc.id,
      queryCount:              (d.queryCount   as number) ?? 0,
      // Totals (used for backward compat in table)
      inputTokens:             (d.inputTokens  as number) ?? 0,
      cacheCreationTokens:     (d.cacheCreationTokens as number) ?? 0,
      cacheReadTokens:         (d.cacheReadTokens     as number) ?? 0,
      outputTokens:            (d.outputTokens as number) ?? 0,
      // Per-provider token breakdown
      claudeQueryCount:        (d.claudeQueryCount        as number) ?? 0,
      claudeInputTokens,
      claudeCacheCreationTokens,
      claudeCacheReadTokens,
      claudeOutputTokens,
      geminiQueryCount:        (d.geminiQueryCount as number) ?? 0,
      geminiInputTokens,
      geminiOutputTokens,
      // Costs recalculated from tokens (ignore stored estimatedCost)
      claudeCost:  claudeCalcCost,
      geminiCost:  geminiCalcCost,
      calculatedCost: claudeCalcCost + geminiCalcCost,
      // Legacy field kept for reference (not used by UI)
      estimatedCost: (d.estimatedCost as number) ?? 0,
    };
  });

  return NextResponse.json({ metrics });
}
