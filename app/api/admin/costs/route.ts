import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const db = getAdminDb();

  // Get last 30 days of metrics
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0];

  const snapshot = await db
    .collection("usageMetrics")
    .where("date", ">=", startDate)
    .orderBy("date", "desc")
    .get();

  const metrics = snapshot.docs.map((doc) => doc.data());

  return NextResponse.json({ metrics });
}
