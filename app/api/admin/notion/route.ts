import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { listNotionPages, fetchPageAsMarkdown, NotionPage } from "@/lib/notion";
import { FieldValue } from "firebase-admin/firestore";
import { detectCategory, calculatePriority, estimateTokenCount } from "@/lib/parsers";

export const maxDuration = 60;

async function getExistingDocByNotionId(
  notionPageId: string
): Promise<{ id: string; notionLastEdited?: string } | null> {
  const db = getAdminDb();
  const snapshot = await db
    .collection("documents")
    .where("notionPageId", "==", notionPageId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return {
    id: doc.id,
    notionLastEdited: doc.data().notionLastEdited,
  };
}

// GET /api/admin/notion — preview pages with sync status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json(
      { error: "NOTION_TOKEN is not configured" },
      { status: 500 }
    );
  }

  try {
    const pages = await listNotionPages();

    const preview = await Promise.all(
      pages.map(async (page: NotionPage) => {
        const existing = await getExistingDocByNotionId(page.id);

        let status: "new" | "update" | "unchanged";
        if (!existing) {
          status = "new";
        } else if (existing.notionLastEdited !== page.lastEdited) {
          status = "update";
        } else {
          status = "unchanged";
        }

        return {
          id: page.id,
          title: page.title,
          lastEdited: page.lastEdited,
          url: page.url,
          status,
        };
      })
    );

    return NextResponse.json({
      pageCount: pages.length,
      pages: preview,
    });
  } catch (error) {
    console.error("Notion preview error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to list Notion pages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/notion — execute sync
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json(
      { error: "NOTION_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const result = {
    added: 0,
    updated: 0,
    unchanged: 0,
    errors: [] as string[],
  };

  try {
    const pages = await listNotionPages();
    const db = getAdminDb();

    for (const page of pages) {
      try {
        const existing = await getExistingDocByNotionId(page.id);

        if (existing && existing.notionLastEdited === page.lastEdited) {
          result.unchanged++;
          continue;
        }

        const content = await fetchPageAsMarkdown(page.id);
        const filename = `${page.title}.md`;
        const category = detectCategory(filename, content);
        const priority = calculatePriority(filename, category);
        const tokenCount = estimateTokenCount(content);

        if (existing) {
          await db.collection("documents").doc(existing.id).update({
            filename,
            content,
            category,
            priority,
            tokenCount,
            notionLastEdited: page.lastEdited,
            lastFetched: FieldValue.serverTimestamp(),
          });
          result.updated++;
        } else {
          await db.collection("documents").add({
            filename,
            content,
            category,
            priority,
            tokenCount,
            uploadedBy: "notion-sync",
            uploadedAt: FieldValue.serverTimestamp(),
            usageCount: 0,
            lastUsed: null,
            sourceType: "notion",
            notionPageId: page.id,
            notionLastEdited: page.lastEdited,
            lastFetched: FieldValue.serverTimestamp(),
          });
          result.added++;
        }
      } catch (pageError) {
        const msg =
          pageError instanceof Error ? pageError.message : "Unknown error";
        result.errors.push(`${page.title}: ${msg}`);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Notion sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
