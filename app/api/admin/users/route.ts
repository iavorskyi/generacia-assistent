import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
    }

    const db = getAdminDb();
    const snapshot = await db
      .collection("users")
      .orderBy("lastSignIn", "desc")
      .get();

    const users = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email ?? "",
        displayName: data.displayName ?? "",
        image: data.image ?? null,
        isAdmin: data.isAdmin === true,
        lastSignIn: data.lastSignIn ?? null,
      };
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("List users error:", error);
    return NextResponse.json({ error: "Внутрішня помилка сервера" }, { status: 500 });
  }
}
