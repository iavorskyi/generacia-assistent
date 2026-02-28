import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { fetchAndParseUrl } from "@/lib/web-parser";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const docRef = db.collection("documents").doc(params.id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const data = doc.data();
  if (data?.sourceType !== "web") {
    return NextResponse.json(
      { error: "This is not a web source" },
      { status: 400 }
    );
  }

  await docRef.delete();

  return NextResponse.json({ success: true });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const docRef = db.collection("documents").doc(params.id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const data = doc.data();
  if (data?.sourceType !== "web") {
    return NextResponse.json(
      { error: "This is not a web source" },
      { status: 400 }
    );
  }

  const url = data.sourceUrl;
  if (!url) {
    return NextResponse.json(
      { error: "No source URL found" },
      { status: 400 }
    );
  }

  try {
    const parsed = await fetchAndParseUrl(url);

    await docRef.update({
      filename: parsed.title,
      content: parsed.content,
      tokenCount: parsed.tokenCount,
      lastFetched: new Date(),
      fetchError: null,
    });

    return NextResponse.json({
      success: true,
      title: parsed.title,
      tokenCount: parsed.tokenCount,
      lastFetched: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch URL";

    await docRef.update({
      fetchError: message,
      lastFetched: new Date(),
    });

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
