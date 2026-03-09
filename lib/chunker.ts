/**
 * Document chunking utilities.
 *
 * Large documents (> CHUNK_THRESHOLD_TOKENS) are split into overlapping
 * chunks stored as separate Firestore documents (isChunk: true).
 * The document selector picks up to MAX_CHUNKS_PER_PARENT per parent.
 *
 * Only documents currently blocked by the per-doc cap (> 60k tokens)
 * need chunking — smaller docs fit in context as-is.
 */
import { estimateTokenCount } from "@/lib/parsers";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { DocumentCategory } from "@/types";

/** Documents with more tokens than this will be chunked at sync time. */
export const CHUNK_THRESHOLD_TOKENS = 60_000; // ~240k chars

/** Max chunks from the same parent included in a single context window. */
export const MAX_CHUNKS_PER_PARENT = 3;

const CHUNK_SIZE_CHARS    = 200_000; // ~50k tokens per chunk
const CHUNK_OVERLAP_CHARS =   5_000; // ~1250 tokens of context overlap

export interface DocChunk {
  content: string;
  chunkIndex: number;
  totalChunks: number;
  tokenCount: number;
}

export function needsChunking(content: string): boolean {
  return estimateTokenCount(content) > CHUNK_THRESHOLD_TOKENS;
}

/**
 * Split content into overlapping chunks.
 * Snaps chunk boundaries to paragraph breaks where possible.
 */
export function createChunks(content: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + CHUNK_SIZE_CHARS, content.length);

    // Snap to a newline boundary within the last 500 chars of the window
    if (end < content.length) {
      const snap = content.lastIndexOf("\n", end);
      if (snap > start + CHUNK_SIZE_CHARS - 500) end = snap + 1;
    }

    const chunkContent = content.slice(start, end);
    chunks.push({
      content: chunkContent,
      chunkIndex: chunks.length,
      totalChunks: 0,          // back-filled after loop
      tokenCount: estimateTokenCount(chunkContent),
    });

    if (end >= content.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }

  const total = chunks.length;
  return chunks.map(c => ({ ...c, totalChunks: total }));
}

export interface SaveChunksMeta {
  filename: string;
  category: DocumentCategory;
  priority: number;
  sourceType: string;
  driveFileId?:   string | null;
  sourceUrl?:     string | null;
  notionPageId?:  string | null;
}

/**
 * Write chunk documents to Firestore. Returns their IDs.
 * Automatically batches writes (Firestore limit = 500 ops/batch).
 */
export async function saveChunks(
  parentId: string,
  chunks:   DocChunk[],
  meta:     SaveChunksMeta
): Promise<string[]> {
  const db = getAdminDb();
  const chunkIds: string[] = [];
  const BATCH_SIZE = 400;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const chunk of chunks.slice(i, i + BATCH_SIZE)) {
      const ref = db.collection("documents").doc();
      chunkIds.push(ref.id);
      batch.set(ref, {
        isChunk:            true,
        parentDocumentId:   parentId,
        chunkIndex:         chunk.chunkIndex,
        totalChunks:        chunk.totalChunks,
        content:            chunk.content,
        tokenCount:         chunk.tokenCount,
        filename:           meta.filename,
        category:           meta.category,
        priority:           meta.priority,
        sourceType:         meta.sourceType,
        ...(meta.driveFileId   ? { driveFileId:   meta.driveFileId }   : {}),
        ...(meta.sourceUrl     ? { sourceUrl:      meta.sourceUrl }     : {}),
        ...(meta.notionPageId  ? { notionPageId:   meta.notionPageId }  : {}),
        createdAt:  FieldValue.serverTimestamp(),
        usageCount: 0,
        lastUsed:   null,
      });
    }
    await batch.commit();
  }

  return chunkIds;
}

/**
 * Delete chunk documents by their Firestore IDs.
 */
export async function deleteChunks(chunkIds: string[]): Promise<void> {
  if (!chunkIds.length) return;
  const db = getAdminDb();
  const BATCH_SIZE = 400;
  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const id of chunkIds.slice(i, i + BATCH_SIZE)) {
      batch.delete(db.collection("documents").doc(id));
    }
    await batch.commit();
  }
}
