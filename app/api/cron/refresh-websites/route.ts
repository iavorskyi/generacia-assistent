import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { fetchAndParseUrl } from "@/lib/web-parser";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET environment variable is not set");
    return NextResponse.json(
      { error: "Cron not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const db = getAdminDb();
  const snapshot = await db
    .collection("documents")
    .where("sourceType", "==", "web")
    .get();

  const results: Array<{
    id: string;
    url: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const url = data.sourceUrl;

    if (!url) {
      results.push({
        id: doc.id,
        url: "",
        success: false,
        error: "No source URL",
      });
      continue;
    }

    try {
      const parsed = await fetchAndParseUrl(url);

      await doc.ref.update({
        filename: parsed.title,
        content: parsed.content,
        tokenCount: parsed.tokenCount,
        lastFetched: new Date(),
        fetchError: null,
      });

      results.push({
        id: doc.id,
        url,
        success: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      await doc.ref.update({
        fetchError: message,
        lastFetched: new Date(),
      });

      results.push({
        id: doc.id,
        url,
        success: false,
        error: message,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  console.log(
    `Cron refresh completed: ${successCount} success, ${errorCount} errors`
  );

  return NextResponse.json({
    total: results.length,
    success: successCount,
    errors: errorCount,
    results,
  });
}
