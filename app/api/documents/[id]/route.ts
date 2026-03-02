import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = getAdminDb();
  const doc = await db.collection("documents").doc(params.id).get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const data = doc.data()!;
  return NextResponse.json({
    id: doc.id,
    filename: data.filename,
    content: data.content,
    category: data.category,
    driveFileId: data.driveFileId ?? null,
    sourceUrl: data.sourceUrl ?? null,
  });
}
