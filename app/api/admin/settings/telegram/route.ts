import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

// GET /api/admin/settings/telegram — returns current allowed users list
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();
  const doc = await db.collection("settings").doc("telegram").get();
  const allowedUsers: string[] = doc.data()?.allowedUsers ?? [];

  return NextResponse.json({ allowedUsers });
}

// POST /api/admin/settings/telegram — updates allowed users list
// Body: { allowedUsers: string[] }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let allowedUsers: string[];
  try {
    const body = await req.json();
    if (!Array.isArray(body.allowedUsers)) {
      return NextResponse.json({ error: "allowedUsers must be an array" }, { status: 400 });
    }
    // Normalise: trim whitespace, ensure @ prefix for usernames (not numeric IDs)
    allowedUsers = body.allowedUsers
      .map((u: string) => String(u).trim())
      .filter(Boolean)
      .map((u: string) => (/^\d+$/.test(u) ? u : u.startsWith("@") ? u : `@${u}`));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const db = getAdminDb();
  await db.collection("settings").doc("telegram").set({
    allowedUsers,
    updatedAt: new Date(),
    updatedBy: session.user.email ?? "unknown",
  });

  return NextResponse.json({ allowedUsers });
}
