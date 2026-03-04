import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { listNotionPages, fetchPageAsMarkdown, NotionPage } from "@/lib/notion";
import { FieldValue } from "firebase-admin/firestore";
import { detectCategory, calculatePriority, estimateTokenCount } from "@/lib/parsers";

export const maxDuration = 300;

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

// POST /api/admin/notion — sync a single page by ID
// Body: { pageId: string; title: string; lastEdited: string; url: string }
export async function POST(req: Request) {
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

  let pageId: string, title: string, lastEdited: string, url: string;
  try {
    const body = await req.json();
    pageId = body.pageId;
    title = body.title;
    lastEdited = body.lastEdited;
    url = body.url ?? "";
    if (!pageId || !title || !lastEdited) {
      return NextResponse.json({ error: "pageId, title and lastEdited are required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const existing = await getExistingDocByNotionId(pageId);

    if (existing && existing.notionLastEdited === lastEdited) {
      return NextResponse.json({ status: "unchanged" });
    }

    const content = await fetchPageAsMarkdown(pageId);
    const filename = `${title}.md`;
    const category = detectCategory(filename, content);
    const priority = calculatePriority(filename, category);
    const tokenCount = estimateTokenCount(content);

    // Use the real Notion URL if provided, otherwise construct from pageId
    const sourceUrl = url || `https://www.notion.so/${pageId.replace(/-/g, "")}`;

    if (existing) {
      await db.collection("documents").doc(existing.id).update({
        filename,
        content,
        category,
        priority,
        tokenCount,
        sourceUrl,
        notionPageId: pageId,
        notionLastEdited: lastEdited,
        lastFetched: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ status: "updated" });
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
        notionPageId: pageId,
        notionLastEdited: lastEdited,
        sourceUrl,
        lastFetched: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ status: "added" });
    }
  } catch (error) {
    console.error("Notion sync error:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
