import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Необхідна автентифікація" }, { status: 401 });
    }

    const db = getAdminDb();
    const doc = await db.collection("conversations").doc(params.id).get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Розмову не знайдено" }, { status: 404 });
    }

    const data = doc.data()!;

    if (data.userId !== session.user.id) {
      return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
    }

    return NextResponse.json({
      conversation: {
        id: doc.id,
        title: (data.title as string) || "Нова розмова",
        messages: data.messages ?? [],
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Load conversation error:", error);
    return NextResponse.json(
      { error: "Внутрішня помилка сервера" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Необхідна автентифікація" }, { status: 401 });
    }

    const db = getAdminDb();
    const doc = await db.collection("conversations").doc(params.id).get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Розмову не знайдено" }, { status: 404 });
    }

    if (doc.data()!.userId !== session.user.id) {
      return NextResponse.json({ error: "Доступ заборонено" }, { status: 403 });
    }

    await db.collection("conversations").doc(params.id).delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return NextResponse.json(
      { error: "Внутрішня помилка сервера" },
      { status: 500 }
    );
  }
}
