import { getAdminDb } from "@/lib/firebase-admin";
import { DocumentCategory } from "@/types";
import { FieldValue } from "firebase-admin/firestore";

const DEFAULT_TOKEN_BUDGET = 50000;  // Claude Haiku (200k context, conservative)
export const GEMINI_TOKEN_BUDGET  = 300000; // Gemini 2.5 Flash (1M context)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SelectedDocument {
  id: string;
  filename: string;
  content: string;
  category: DocumentCategory;
  priority: number;
  tokenCount: number;
  // Source identifiers (present for Drive/Notion/web-sourced documents)
  driveFileId?: string | null;
  sourceUrl?: string | null;
  notionPageId?: string | null;
}

export interface DocMeta {
  id: string;
  filename: string;
  category: string;
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
        // Ukrainian: price, warehouse/stock, availability, remainder, quantity,
        // supplier, order, goods, product, batch, price list
        "прайс",
        "ціна",
        "вартість",
        "склад",
        "наявніст",
        "залишок",
        "кількість",
        "постачальник",
        "замовлення",
        "товар",
        "продукт",
        "партія",
        "на складі",
        "в наявності",
        "скільки",
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

export interface SelectDocumentsResult {
  documents: SelectedDocument[];
  allDocumentNames: DocMeta[];
  fromCache: boolean;
}

export async function selectDocuments(
  query: string,
  conversationId?: string | null,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET
): Promise<SelectDocumentsResult> {
  const MAX_TOKEN_BUDGET = tokenBudget;
  const db = getAdminDb();

  // 1. Fetch metadata for ALL documents (no content field — lightweight)
  const metaSnapshot = await db
    .collection("documents")
    .select("filename", "category", "priority", "tokenCount")
    .orderBy("priority", "desc")
    .get();

  const allMeta: DocMeta[] = metaSnapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      filename: data.filename as string,
      category: data.category as string,
      priority: data.priority as number,
      tokenCount: data.tokenCount as number,
    };
  });

  // 2. Check if conversation has a valid cache.
  //    Only use it if all filename-matched docs for this query are already cached.
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
      const cachedIds: string[] = convData?.cachedDocumentIds ?? [];
      const cachedIdSet = new Set(cachedIds);

      // Quick filename-match check against metadata (no content fetch)
      const queryWordsForCache = query
        .toLowerCase()
        .split(/[\s,.()\[\]\/\\]+/)
        .filter((w) => w.length >= 3);

      const STEM = 6;
      const filenameMatchesForCache = queryWordsForCache.length > 0
        ? allMeta.filter((d) => {
            const lower = d.filename.toLowerCase();
            return queryWordsForCache.some((w) => {
              if (lower.includes(w)) return true;
              if (w.length >= STEM) {
                const stem = w.substring(0, STEM);
                return lower.split(/[\s_\-.,()]+/).some(
                  (fw) => fw.length >= STEM && fw.substring(0, STEM) === stem
                );
              }
              return false;
            });
          })
        : [];

      // If every filename-matched doc is already in the cache, reuse it
      const allMatchesCached = filenameMatchesForCache.every((d) => cachedIdSet.has(d.id));

      if (allMatchesCached) {
        const docDocs = await Promise.all(
          cachedIds.map((id) => db.collection("documents").doc(id).get())
        );
        const documents = docDocs
          .filter((d) => d.exists)
          .map((d) => ({ id: d.id, ...d.data() } as SelectedDocument));

        return { documents, allDocumentNames: allMeta, fromCache: true };
      }
      // Otherwise fall through and re-select with the new query
    }
  }

  // 3. Build prioritized order for content selection:
  //    filename keyword matches → category matches → rest by priority
  const queryCategory = detectQueryCategory(query);

  // Find docs whose filename contains query words (min 3 chars)
  // Uses prefix/stem matching (first 6 chars) to handle Ukrainian morphology
  // e.g. "опрацювувати" matches "Опрацювання", "сервісне" matches "сервісних"
  const queryWords = query
    .toLowerCase()
    .split(/[\s,.()\[\]\/\\]+/)
    .filter((w) => w.length >= 3);

  const STEM_LEN = 6;
  function stemMatch(queryWord: string, filenameText: string): boolean {
    // Exact substring match
    if (filenameText.includes(queryWord)) return true;
    // Prefix/stem match for words long enough
    if (queryWord.length >= STEM_LEN) {
      const qStem = queryWord.substring(0, STEM_LEN);
      const filenameWords = filenameText.split(/[\s_\-.,()]+/);
      return filenameWords.some(
        (fw) => fw.length >= STEM_LEN && fw.substring(0, STEM_LEN) === qStem
      );
    }
    return false;
  }

  const filenameMatches =
    queryWords.length > 0
      ? allMeta.filter((d) => {
          const lower = d.filename.toLowerCase();
          return queryWords.some((w) => stemMatch(w, lower));
        })
      : [];
  const filenameMatchIds = new Set(filenameMatches.map((d) => d.id));

  const categoryMatches = queryCategory
    ? allMeta.filter(
        (d) => d.category === queryCategory && !filenameMatchIds.has(d.id)
      )
    : [];
  const categoryMatchIds = new Set(categoryMatches.map((d) => d.id));

  const remaining = allMeta.filter(
    (d) => !filenameMatchIds.has(d.id) && !categoryMatchIds.has(d.id)
  );

  // 4. Order: when query intent is clear (queryCategory detected), put category
  //    matches FIRST so intent-relevant docs (e.g. price list) always fit in
  //    the token budget before large filename-matched technical manuals.
  //    Without clear intent, keep legacy order: filename → category → remaining.
  const orderedMeta = queryCategory
    ? [...categoryMatches, ...filenameMatches, ...remaining]
    : [...filenameMatches, ...categoryMatches, ...remaining];

  // 5. Select which docs fit within the token budget.
  //    Category matches (intent-relevant) are always included.
  //    Filename matches and remaining docs must fit within the budget.
  const selectedMeta: DocMeta[] = [];
  let tokenTotal = 0;

  for (const doc of orderedMeta) {
    const isFilenameMatch = filenameMatchIds.has(doc.id);
    const isCategoryMatch = categoryMatchIds.has(doc.id);

    if (isCategoryMatch) {
      // Always include category matches — they directly answer the query intent
      selectedMeta.push(doc);
      tokenTotal += doc.tokenCount;
    } else if (tokenTotal + doc.tokenCount <= MAX_TOKEN_BUDGET) {
      // Filename/remaining docs: only if they fit in the budget
      selectedMeta.push(doc);
      tokenTotal += doc.tokenCount;
    }

    // Stop adding non-category docs once we're at 90% of budget
    if (!isCategoryMatch && tokenTotal >= MAX_TOKEN_BUDGET * 0.9) break;
  }

  // 5. Fetch full content only for the selected docs
  const fullDocs = await Promise.all(
    selectedMeta.map((m) => db.collection("documents").doc(m.id).get())
  );
  const selected: SelectedDocument[] = fullDocs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, ...d.data() } as SelectedDocument));

  // 6. Update usage stats for selected documents (fire and forget)
  const batch = db.batch();
  for (const doc of selected) {
    const ref = db.collection("documents").doc(doc.id);
    batch.update(ref, {
      usageCount: FieldValue.increment(1),
      lastUsed: new Date(),
    });
  }
  await batch.commit().catch(() => {}); // non-critical

  return { documents: selected, allDocumentNames: allMeta, fromCache: false };
}
