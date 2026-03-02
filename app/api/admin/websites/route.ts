import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { fetchAndParseUrl } from "@/lib/web-parser";
import { DocumentCategory } from "@/types";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const snapshot = await db
    .collection("documents")
    .where("sourceType", "==", "web")
    .get();

  const websites = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .sort((a, b) => {
      const dataA = a as { uploadedAt?: { toDate?: () => Date } | Date | string };
      const dataB = b as { uploadedAt?: { toDate?: () => Date } | Date | string };
      const dateA = typeof dataA.uploadedAt === 'object' && dataA.uploadedAt && 'toDate' in dataA.uploadedAt
        ? dataA.uploadedAt.toDate!()
        : new Date(dataA.uploadedAt as string || 0);
      const dateB = typeof dataB.uploadedAt === 'object' && dataB.uploadedAt && 'toDate' in dataB.uploadedAt
        ? dataB.uploadedAt.toDate!()
        : new Date(dataB.uploadedAt as string || 0);
      return dateB.getTime() - dateA.getTime();
    });

  return NextResponse.json({ websites });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { url, category, priority, crawlLinks, maxPages } = body as {
    url: string;
    category: DocumentCategory;
    priority: number;
    crawlLinks?: boolean;
    maxPages?: number;
  };

  // Validate URL
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  // Check if URL already exists
  const db = getAdminDb();
  const existing = await db
    .collection("documents")
    .where("sourceUrl", "==", url)
    .limit(1)
    .get();

  if (!existing.empty) {
    return NextResponse.json(
      { error: "This URL is already added as a source" },
      { status: 400 }
    );
  }

  // Fetch and parse the URL
  try {
    const parsed = await fetchAndParseUrl(url, {
      crawlLinks: crawlLinks ?? false,
      maxPages: maxPages ?? Infinity,
    });

    const docRef = await db.collection("documents").add({
      filename: parsed.title,
      content: parsed.content,
      category: category || "general",
      priority: priority ?? 50,
      tokenCount: parsed.tokenCount,
      uploadedBy: session.user.email,
      uploadedAt: new Date(),
      usageCount: 0,
      sourceType: "web",
      sourceUrl: url,
      lastFetched: new Date(),
    });

    return NextResponse.json({
      id: docRef.id,
      title: parsed.title,
      url,
      category: category || "general",
      priority: priority ?? 50,
      tokenCount: parsed.tokenCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch URL";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
