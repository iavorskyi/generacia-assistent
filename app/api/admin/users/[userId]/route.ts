import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
    }

    // Prevent self-demotion
    if (params.userId === session.user.id) {
      return NextResponse.json(
        { error: "Не можна змінити власні права адміністратора" },
        { status: 400 }
      );
    }

    const { isAdmin } = await request.json() as { isAdmin: boolean };

    const db = getAdminDb();
    const userRef = db.collection("users").doc(params.userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
    }

    await userRef.update({
      isAdmin,
      ...(isAdmin
        ? { madeAdminAt: new Date().toISOString(), madeAdminBy: session.user.email }
        : { removedAdminAt: new Date().toISOString(), removedAdminBy: session.user.email }),
    });

    return NextResponse.json({ success: true, isAdmin });
  } catch (error) {
    console.error("Update user admin error:", error);
    return NextResponse.json({ error: "Внутрішня помилка сервера" }, { status: 500 });
  }
}
