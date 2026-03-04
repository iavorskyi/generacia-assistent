import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Необхідна автентифікація" }, { status: 401 });
    }

    const db = getAdminDb();
    const snapshot = await db
      .collection("conversations")
      .where("userId", "==", session.user.id)
      .orderBy("updatedAt", "desc")
      .limit(30)
      .get();

    const conversations = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: (data.title as string) || "Нова розмова",
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        messageCount: (data.messages ?? []).length,
      };
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Conversations list error:", error);
    return NextResponse.json(
      { error: "Внутрішня помилка сервера" },
      { status: 500 }
    );
  }
}
