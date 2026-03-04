import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const source = request.nextUrl.searchParams.get("source"); // "drive"|"notion"|"web"|null

  const db = getAdminDb();
  const col = db.collection("documents");

  // When filtering by sourceType, skip orderBy to avoid requiring a composite index.
  // The admin UI already sorts client-side, so ordering here is not needed.
  let query;
  if (source === "drive" || source === "notion" || source === "web") {
    query = col.where("sourceType", "==", source);
  } else {
    query = col.orderBy("uploadedAt", "desc");
  }

  const snapshot = await query.get();

  const documents = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return NextResponse.json({ documents });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { ids } = await request.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const db = getAdminDb();
  // Firestore batch: max 500 ops per commit
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = db.batch();
    ids.slice(i, i + CHUNK).forEach((id) => {
      batch.delete(db.collection("documents").doc(id));
    });
    await batch.commit();
  }

  return NextResponse.json({ deleted: ids.length });
}
