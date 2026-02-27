import { getAdminDb } from "@/lib/firebase-admin";
import { DocumentCategory } from "@/types";
import { FieldValue } from "firebase-admin/firestore";

const MAX_TOKEN_BUDGET = 50000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SelectedDocument {
  id: string;
  filename: string;
  content: string;
  category: DocumentCategory;
  priority: number;
  tokenCount: number;
}

// Detect query category from question keywords
export function detectQueryCategory(query: string): DocumentCategory | null {
  const lower = query.toLowerCase();

  const patterns: { category: DocumentCategory; keywords: string[] }[] = [
    {
      category: "hr",
      keywords: [
        "vacation",
        "leave",
        "holiday",
        "pto",
        "sick",
        "benefit",
        "salary",
        "payroll",
        "onboard",
        "hire",
        "employee",
        "performance",
        "review",
        "hr ",
      ],
    },
    {
      category: "engineering",
      keywords: [
        "deploy",
        "code",
        "api",
        "technical",
        "server",
        "database",
        "git",
        "ci/cd",
        "docker",
        "infrastructure",
        "bug",
        "release",
        "architecture",
      ],
    },
    {
      category: "policy",
      keywords: [
        "policy",
        "procedure",
        "compliance",
        "security",
        "password",
        "gdpr",
        "data protection",
        "acceptable use",
        "code of conduct",
      ],
    },
    {
      category: "finance",
      keywords: [
        "expense",
        "reimburse",
        "budget",
        "invoice",
        "receipt",
        "finance",
        "payment",
        "cost",
      ],
    },
    {
      category: "legal",
      keywords: [
        "contract",
        "agreement",
        "nda",
        "legal",
        "liability",
        "terms",
        "ip",
        "intellectual property",
      ],
    },
  ];

  for (const { category, keywords } of patterns) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }

  return null;
}

// Check if cached document list is still valid
function isCacheValid(cacheValidUntil?: Date | null): boolean {
  if (!cacheValidUntil) return false;
  return new Date(cacheValidUntil).getTime() > Date.now();
}

export async function selectDocuments(
  query: string,
  conversationId?: string | null
): Promise<{ documents: SelectedDocument[]; fromCache: boolean }> {
  const db = getAdminDb();

  // Check if conversation has a valid cache
  if (conversationId) {
    const convDoc = await db
      .collection("conversations")
      .doc(conversationId)
      .get();
    const convData = convDoc.data();

    if (
      convData?.cachedDocumentIds?.length > 0 &&
      isCacheValid(convData?.cacheValidUntil?.toDate())
    ) {
      // Reuse cached documents
      const cachedIds: string[] = convData?.cachedDocumentIds ?? [];
      const docPromises = cachedIds.map((id) =>
        db.collection("documents").doc(id).get()
      );
      const docDocs = await Promise.all(docPromises);
      const documents = docDocs
        .filter((d) => d.exists)
        .map((d) => ({ id: d.id, ...d.data() } as SelectedDocument));

      return { documents, fromCache: true };
    }
  }

  // Fresh document selection
  const queryCategory = detectQueryCategory(query);

  // Fetch documents ordered by priority
  let queryRef = db
    .collection("documents")
    .orderBy("priority", "desc")
    .limit(50);

  const snapshot = await queryRef.get();
  const allDocs = snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as SelectedDocument)
  );

  // Prioritize category matches
  const categoryMatches = queryCategory
    ? allDocs.filter((d) => d.category === queryCategory)
    : [];
  const otherDocs = allDocs.filter((d) =>
    queryCategory ? d.category !== queryCategory : true
  );

  const orderedDocs = [...categoryMatches, ...otherDocs];

  // Select documents within token budget
  const selected: SelectedDocument[] = [];
  let tokenTotal = 0;

  for (const doc of orderedDocs) {
    if (tokenTotal + doc.tokenCount <= MAX_TOKEN_BUDGET) {
      selected.push(doc);
      tokenTotal += doc.tokenCount;
    }
    if (tokenTotal >= MAX_TOKEN_BUDGET * 0.9) break; // leave 10% buffer
  }

  // Update usage stats for selected documents
  const batch = db.batch();
  for (const doc of selected) {
    const ref = db.collection("documents").doc(doc.id);
    batch.update(ref, {
      usageCount: FieldValue.increment(1),
      lastUsed: new Date(),
    });
  }
  await batch.commit().catch(() => {}); // non-critical

  return { documents: selected, fromCache: false };
}
