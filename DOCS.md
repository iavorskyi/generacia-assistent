# Генерація AI Assistant — Detailed Documentation

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [RAG Pipeline](#2-rag-pipeline)
3. [Document Sources](#3-document-sources)
4. [Document Processing](#4-document-processing)
5. [Document Selector](#5-document-selector)
6. [AI Providers](#6-ai-providers)
7. [Chunking System](#7-chunking-system)
8. [Document Categories](#8-document-categories)
9. [Chat & Conversations](#9-chat--conversations)
10. [Admin Panel](#10-admin-panel)
11. [Telegram Bot](#11-telegram-bot)
12. [Authentication & Access Control](#12-authentication--access-control)
13. [Cost Tracking](#13-cost-tracking)
14. [Data Models (Firestore)](#14-data-models-firestore)
15. [API Reference](#15-api-reference)
16. [Environment Variables](#16-environment-variables)
17. [Key Thresholds & Constants](#17-key-thresholds--constants)
18. [Deployment](#18-deployment)

---

## 1. Architecture Overview

```
User / Telegram
     │
     ▼
Next.js App (Vercel)
     │
     ├── Chat UI (app/page.tsx)
     │       │
     │       ▼
     │   POST /api/chat
     │       │
     │       ├── Document Selector (lib/document-selector.ts)
     │       │       └── Firestore: documents collection
     │       │
     │       ├── Claude Haiku  ──┐
     │       └── Gemini 2.5 Flash┘  (depending on active provider)
     │
     ├── Admin Panel (app/admin/)
     │       │
     │       ├── Drive Sync → Google Drive API
     │       ├── Notion Sync → Notion API
     │       ├── File Upload → Parsers → Firestore
     │       └── Web Sources → Web Scraper → Firestore
     │
     └── Telegram Bot (app/api/bot/telegram/)
             └── Same RAG pipeline as Chat UI
```

**Data flow for a user query:**
1. User types a question in the chat
2. `/api/chat` receives the query and existing conversation context
3. `document-selector.ts` selects the most relevant documents from Firestore
4. Selected documents + conversation history sent to AI provider
5. AI responds with an answer and cites source filenames
6. Citations matched to document IDs and rendered as clickable links
7. Conversation saved to Firestore for history

---

## 2. RAG Pipeline

The core of the system is in `lib/document-selector.ts`. It implements a 3-tier document prioritization strategy.

### Step 1: Query Category Detection

The query is analysed for intent using keyword matching (`detectQueryCategory`):

| Category | Example keywords |
|---|---|
| `hr` | відпустка, зарплата, оклад, onboarding, benefits |
| `engineering` | деплой, API, сервер, інфраструктура, архітектура |
| `policy` | процедура, compliance, GDPR, безпека |
| `finance` | рахунок, бюджет, витрати, прайс, інвойс |
| `legal` | договір, NDA, угода, контракт |
| `regulations` | ПУЕ, ДБН, ДСТУ, ПЗВ, заземлення, санвузол |

### Step 2: Document Prioritization

Documents are ranked in this order:
1. **Category matches** — documents whose category matches the detected query category. Always included, no token budget limit.
2. **Filename matches** — documents whose filename contains keywords from the query (Ukrainian stem matching: 6-char prefix).
3. **Remaining documents** — all other docs, ordered by `priority` score descending.

### Step 3: Token Budget Enforcement

| Provider | Total budget |
|---|---|
| Claude Haiku | 100,000 tokens |
| Gemini 2.5 Flash | 250,000 tokens |

Rules:
- Category matches are always included (bypass budget)
- Other docs added greedily until 90% of budget is reached
- Documents >60k tokens individually are excluded (chunked docs used instead)
- Chunked documents: max 3 chunks per parent selected per context window

### Step 4: Conversation Caching

To reduce costs on follow-up questions:
- First query: document IDs selected are saved to the conversation (`cachedDocumentIds`)
- Cache is valid for **5 minutes** (`cacheValidUntil`)
- Follow-up queries within 5 min reuse the same document set without re-running selection
- Cache is invalidated if the query category changes significantly

### Step 5: Prompt Caching (Claude only)

Claude supports ephemeral prompt caching. The document context block is marked with `cache_control: { type: "ephemeral" }`. Subsequent requests within the cache TTL read from cache at $0.03/1M tokens instead of $0.25/1M — a **90% saving** on input tokens.

---

## 3. Document Sources

### Google Drive

- Configured via `GOOGLE_DRIVE_FOLDER_ID` env var
- Supports regular Drive folders and Shared Drives
- Recursive BFS traversal of folder tree (parallel requests)
- Handles Google Workspace files (Docs → Markdown, Sheets → CSV, Slides → plain text)
- Sync detects: `new` (not in Firestore), `update` (Drive modifiedTime > stored), `unchanged`
- `driveModifiedTime` comparison prevents redundant re-parsing

**Supported Drive file types:**
- Google Docs → exported as Markdown
- Google Sheets → exported as CSV → parsed to markdown table
- Google Slides → exported as plain text
- PDF, DOCX, XLSX, TXT, Markdown → downloaded as binary

### Notion

- Configured via `NOTION_TOKEN` env var
- Lists pages/databases from connected workspace
- Renders Notion blocks as Markdown:
  - Headings (H1–H3)
  - Bullet lists, numbered lists, toggle lists
  - Tables (with headers)
  - Code blocks (with language tag)
  - Quotes, callouts
  - Dividers
  - Nested children (recursive)
- `notionLastEdited` comparison for change detection

### File Upload

- Admin uploads via admin panel drag-and-drop
- Max file size: 10MB
- Accepted formats: PDF, DOCX, XLSX, XLS, CSV, TXT, MD
- Automatically parsed on upload
- Chunked if >60k tokens

### Web Sources

- Admin adds URLs via admin panel
- Fetches HTML or PDF content
- HTML: extracts text with Cheerio (removes scripts, styles, nav, footer)
- PDF: parsed with `pdf-parse`, OCR fallback with Gemini Vision if no text found
- Optional same-domain crawling (BFS, configurable depth)
- Periodic refresh via cron endpoint: `GET /api/cron/refresh-websites`
- `fetchError` stored if scraping fails

---

## 4. Document Processing

### File Parsing (`lib/parsers.ts`)

| Format | Library | Notes |
|---|---|---|
| PDF | `pdf-parse` | Falls back to Gemini Vision OCR for scanned PDFs |
| DOCX | `mammoth` | Converts to Markdown |
| XLSX / XLS | `xlsx` (SheetJS) | Each sheet becomes a markdown table section |
| CSV | `xlsx` | Treated as single-sheet spreadsheet |
| TXT / MD | Native | Read as-is |

**Spreadsheet parsing rules:**
- Max 2,000 rows per sheet (truncated with notice if exceeded)
- Columns where ALL data rows are empty are automatically removed
- Inline newlines in cells replaced with `\n` (escaped)
- Pipe `|` characters in cells escaped as `\|`

### Category & Priority Detection

After parsing, each document is automatically assigned a `category` and `priority`:

| Category | Detection keywords | Priority |
|---|---|---|
| `hr` | відпустка, зарплата, оклад, HR, вакансія | 70 |
| `regulations` | ПУЕ → 85, ДБН/ДСТУ → 80, others → 65 | varies |
| `engineering` | деплой, API, сервер, Docker | 70 |
| `policy` | процедура, compliance, GDPR | 60 |
| `finance` | прайс, рахунок, бюджет, склад | 85 |
| `legal` | договір, NDA, угода | 60 |
| `general` | default fallback | 50 |

Finance gets the highest default priority (85) because price lists and inventory docs are the most frequently queried.

---

## 5. Document Selector

**File:** `lib/document-selector.ts`

Key functions:

```typescript
selectDocuments(query, conversationId, provider)
  → { documents: Document[], fromCache: boolean }
```

**Filename stem matching:**
Ukrainian words are heavily inflected. The selector uses 6-character prefix matching to handle morphological variants:
- "відпустк" matches відпустка, відпустки, відпустці, відпусток...
- Query words <6 chars are matched exactly

**Per-document hard cap:**
Documents with `tokenCount > 60000` are excluded from direct selection. Their chunks are used instead (if they are `isChunked: true`).

**Chunk selection logic:**
- Parent doc with `isChunked: true` and `chunkIds[]` is eligible
- Chunks loaded individually from Firestore
- Up to 3 chunks selected per parent per context
- Chunks contribute to the token budget like regular docs

---

## 6. AI Providers

### Claude Haiku (`lib/claude.ts`)

- Model: `claude-haiku-4-5` (or latest Haiku)
- Context window: 200k tokens
- Default token budget for documents: **100k tokens**
- Supports prompt caching (`cache_control: ephemeral`)
- System prompt: loaded from Firestore `settings/system` doc (60-second in-memory cache)

**Pricing (per 1M tokens):**
| Token type | Price |
|---|---|
| Input | $0.25 |
| Cache write | $0.30 |
| Cache read | $0.03 |
| Output | $1.25 |

### Gemini 2.5 Flash (`lib/gemini.ts`)

- Model: `gemini-2.5-flash-preview-04-17`
- Context window: 1,000,000 tokens
- Default token budget for documents: **250k tokens**
- No prompt caching support
- Higher document budget due to larger context window

**Pricing (per 1M tokens):**
| Token type | Price |
|---|---|
| Input | $0.15 |
| Output | $0.60 |

### Switching Providers

Admin panel → Settings tab → select provider. Stored in Firestore `settings/provider`. Takes effect immediately for all new queries (no restart needed).

---

## 7. Chunking System

**File:** `lib/chunker.ts`

### When chunking is triggered

A document is chunked when its content exceeds **60,000 tokens** (~240,000 characters).

### Chunk parameters

| Parameter | Value |
|---|---|
| Chunk size | 200,000 chars (~50k tokens) |
| Overlap | 5,000 chars (~1.25k tokens) |
| Snap to | Paragraph boundary (`\n\n`) within ±500 chars of chunk end |
| Max chunks selected per context | 3 |

### Firestore structure

**Parent document:**
```
documents/{parentId}
  filename: "ПУЕ.pdf"
  isChunked: true
  chunkIds: ["chunk1Id", "chunk2Id", ...]
  chunkCount: 10
  tokenCount: 225000   // total (full doc)
  content: "...first 1000 chars preview..."
  category: "regulations"
  priority: 85
```

**Chunk document:**
```
documents/{chunkId}
  isChunk: true
  parentDocumentId: "parentId"
  chunkIndex: 0
  filename: "ПУЕ.pdf"
  content: "...50k token chunk..."
  category: "regulations"
  priority: 85
  sourceType: "drive"
  sourceUrl: "https://drive.google.com/..."
  // Note: driveFileId is NOT stored on chunks
```

### Why `driveFileId` is not on chunks

`getExistingDocByDriveId` queries by `driveFileId` to find the parent during re-sync. If chunks also had `driveFileId`, the query could accidentally return a chunk and corrupt the sync by treating a chunk as the parent.

---

## 8. Document Categories

```typescript
type DocumentCategory =
  | "hr"           // HR: vacations, payroll, onboarding, benefits
  | "engineering"  // Tech: deployments, APIs, architecture, infrastructure
  | "policy"       // Policies: procedures, compliance, GDPR, security
  | "finance"      // Finance: price lists, invoices, budgets, warehouse stock
  | "legal"        // Legal: contracts, NDAs, agreements
  | "regulations"  // Ukrainian normative docs: ПУЕ, ДБН, ДСТУ, НПАОП
  | "general"      // Default fallback
```

Category is used in two ways:
1. **At ingestion** — auto-assigned during parsing based on filename/content keywords
2. **At retrieval** — query category detection selects matching docs first

Admin can manually override category and priority per document in the admin panel.

---

## 9. Chat & Conversations

### Conversation data model

```
conversations/{conversationId}
  userId: string
  messages: Message[]
  cachedDocumentIds: string[]   // last used doc IDs
  cacheValidUntil: Timestamp    // 5 min from last query
  createdAt: Timestamp
  updatedAt: Timestamp
```

```typescript
interface Message {
  role: "user" | "assistant"
  content: string
  citations?: Citation[]        // source files referenced in response
  timestamp: Timestamp
  cacheStatus?: "created" | "read"  // Claude cache indicator
}

interface Citation {
  filename: string
  documentId: string
  sourceUrl?: string            // Drive URL or web URL (clickable)
}
```

### Citation extraction

The AI is instructed to reference sources by filename in its response (e.g., `[ПУЕ.pdf]`). After generation, the response is parsed with a regex to extract filenames, which are then matched against the selected documents to build the `citations` array. Cited Drive files and web sources become clickable links.

### Suggested questions

Displayed on empty chat. Hardcoded list in Ukrainian covering common use cases:
- HR (vacations, onboarding)
- Procedures (request processes)
- Security (remote access)
- Technical questions

### Cache status indicator

When Claude's prompt cache is used, the UI shows a small indicator:
- **"Кеш створено"** — first query, cache written (slightly more expensive)
- **"З кешу"** — follow-up query, cache read (90% cheaper input cost)

---

## 10. Admin Panel

### Tab: Documents

- Shows all documents in Firestore (chunks excluded via `isChunk: false` filter)
- Columns: filename, category, priority, token count, source type, last fetched, usage count
- Sort by any column
- Search/filter by filename, category
- Inline edit of category and priority (saved to Firestore on change)
- Bulk delete selected documents
- Delete also removes associated chunk documents

### Tab: Google Drive

- Lists all files in the configured Drive folder (recursive)
- Each file shows sync status:
  - **Новий** — not yet synced to Firestore
  - **Оновлено** — Drive file newer than Firestore copy
  - **Актуальний** — in sync
  - **Видалено з джерела** — in Firestore but not found in Drive
- Sync individual file or selected batch
- Inline category/priority edit for already-synced docs
- Real-time progress bar for batch sync

### Tab: Notion

- Lists pages from connected Notion workspace
- Same status logic as Drive tab
- Sync individual page or selected batch

### Tab: Веб-сайти

- Add URLs to scrape
- Optional: enable crawling (fetches all same-domain links found on the page)
- Status: OK / error (shown with error message)
- Manual refresh or wait for cron job (`/api/cron/refresh-websites`)

### Tab: Налаштування

- **AI Provider** — switch between Claude Haiku and Gemini 2.5 Flash
- **System Prompt** — edit the instruction text sent before every conversation (saved to Firestore)

### Tab: Користувачі

- List all users who have signed in
- Toggle admin status per user
- Shows email, display name, last sign-in

### Tab: Telegram

- View and update the list of allowed Telegram usernames/IDs
- Stored in Firestore `settings/telegram`
- Env var `TELEGRAM_ALLOWED_USERS` used as fallback if Firestore list is empty

### Tab: Витрати

- Last 30 days of token usage and cost
- Per-provider breakdown (Claude vs Gemini)
- Shows: queries, input tokens, cache tokens, output tokens, estimated cost
- Costs calculated server-side from token counts with current pricing

---

## 11. Telegram Bot

**Route:** `POST /api/bot/telegram`

Setup:
1. Create bot via @BotFather, get token
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` env vars
3. Register webhook: `https://api.telegram.org/bot{TOKEN}/setWebhook?url={APP_URL}/api/bot/telegram&secret_token={SECRET}`

**Features:**
- Same RAG pipeline as web chat
- Maintains per-user conversation history (stored in Firestore under a generated conversation ID)
- Typing indicator (`sendChatAction: typing`) while processing
- Markdown formatting in responses
- Falls back to plain text if Telegram rejects markdown
- Long responses chunked at 4096 characters (Telegram limit)
- Allowed users: checked against Firestore `settings/telegram` list, falls back to `TELEGRAM_ALLOWED_USERS` env var

---

## 12. Authentication & Access Control

**Provider:** Google OAuth via NextAuth.js

**Flow:**
1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent screen
3. On success: callback to `/api/auth/callback/google`
4. NextAuth checks if email domain matches `ALLOWED_EMAIL_DOMAIN` (if set)
5. User record upserted to Firestore `users/{userId}`
6. JWT session token issued with `userId` and `isAdmin` flag

**Domain restriction:**
```env
ALLOWED_EMAIL_DOMAIN=yourcompany.com
```
If set, only emails ending with `@yourcompany.com` can sign in.

**Admin access:**
The `isAdmin` flag is stored per user in Firestore. To grant admin access:
```bash
node scripts/make-admin.ts user@company.com
```

**Firestore security rules:**
- `users/` — users read/write own profile; admins read all
- `documents/` — all authenticated users can read; only server (admin SDK) can write
- `conversations/` — users read/write only their own conversations
- `usageMetrics/` — admins read; only server writes
- `settings/` — admins read/write

---

## 13. Cost Tracking

**Collection:** `usageMetrics/{YYYY-MM-DD}`

Every successful AI response logs:
```
{
  date: "2026-03-09"
  queryCount: 1
  inputTokens: 45000
  cacheCreationTokens: 45000  // Claude only, first query
  cacheReadTokens: 0
  outputTokens: 350
  estimatedCost: 0.0124
  claudeQueryCount: 1
  claudeInputTokens: 45000
  claudeCacheCreationTokens: 45000
  claudeOutputTokens: 350
  geminiQueryCount: 0
  geminiInputTokens: 0
  geminiOutputTokens: 0
}
```

Metrics are merged daily using Firestore `FieldValue.increment()` so multiple queries in a day accumulate correctly.

**Cost formula (Claude):**
```
cost = (inputTokens × 0.25 + cacheCreationTokens × 0.30 + cacheReadTokens × 0.03 + outputTokens × 1.25) / 1_000_000
```

**Cost formula (Gemini):**
```
cost = (inputTokens × 0.15 + outputTokens × 0.60) / 1_000_000
```

Admin panel shows last 30 days with daily breakdown and totals.

---

## 14. Data Models (Firestore)

### `documents/{id}`

```typescript
{
  // Core
  filename: string
  content: string             // full text (or 1000-char preview if chunked)
  category: DocumentCategory
  priority: number            // 50–90
  tokenCount: number

  // Metadata
  uploadedBy: string          // user email or "drive-sync" / "notion-sync"
  uploadedAt: Timestamp
  usageCount: number
  lastUsed: Timestamp | null

  // Source tracking
  sourceType: "file" | "drive" | "web" | "notion"
  sourceUrl?: string

  // Drive-specific
  driveFileId?: string
  driveModifiedTime?: string  // ISO string

  // Web-specific
  lastFetched?: Timestamp
  fetchError?: string

  // Notion-specific
  notionPageId?: string
  notionLastEdited?: string

  // Chunking
  isChunked?: true | null     // parent doc that has been split
  chunkIds?: string[]
  chunkCount?: number
  isChunk?: true              // this IS a chunk (not a parent)
  parentDocumentId?: string
  chunkIndex?: number

  // Legacy
  truncated?: boolean
}
```

### `conversations/{id}`

```typescript
{
  userId: string
  messages: {
    role: "user" | "assistant"
    content: string
    citations?: { filename: string; documentId: string; sourceUrl?: string }[]
    timestamp: Timestamp
    cacheStatus?: "created" | "read"
  }[]
  cachedDocumentIds: string[]
  cacheValidUntil: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### `users/{id}`

```typescript
{
  email: string
  displayName: string
  image: string | null
  isAdmin: boolean
  createdAt: Timestamp
  lastSignIn: Timestamp
}
```

### `settings/system`

```typescript
{ prompt: string }   // the system prompt text
```

### `settings/provider`

```typescript
{ provider: "claude" | "gemini" }
```

### `settings/telegram`

```typescript
{ allowedUsers: string[] }   // Telegram usernames or user IDs
```

### `usageMetrics/{YYYY-MM-DD}`

See [Cost Tracking](#13-cost-tracking) section above.

---

## 15. API Reference

### `POST /api/chat`

**Request:**
```json
{
  "message": "Яка норма відпустки?",
  "conversationId": "abc123"
}
```

**Response:**
```json
{
  "response": "Згідно з...",
  "citations": [
    { "filename": "HR Policy.docx", "documentId": "xyz", "sourceUrl": null }
  ],
  "conversationId": "abc123",
  "cacheStatus": "created"
}
```

---

### `GET /api/admin/documents`

Returns all non-chunk documents. Query params: `source=drive|notion|file|web`

### `POST /api/admin/upload`

Multipart form upload. Field: `file`. Returns parsed doc metadata.

### `GET /api/admin/drive`

Returns Drive files with sync status. Requires Drive folder configured.

### `POST /api/admin/drive`

**Body:** `{ fileId, name, mimeType, modifiedTime }`
Syncs one file. Returns `{ status: "added" | "updated" | "unchanged", chunked?, chunkCount? }`

### `GET /api/admin/notion`

Returns Notion pages with sync status.

### `POST /api/admin/notion`

**Body:** `{ pageId, title, url, lastEdited }`
Syncs one Notion page.

### `GET /api/admin/settings`

Returns `{ provider: "claude" | "gemini", prompt: string }`

### `POST /api/admin/settings`

**Body:** `{ provider? }` or `{ prompt? }` — updates provider or system prompt.

### `GET /api/admin/costs`

Returns last 30 days of usage metrics array.

### `GET /api/cron/refresh-websites`

Refreshes all web sources. Requires `Authorization: Bearer {CRON_SECRET}` header.

---

## 16. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes* | Claude API key (*if using Claude) |
| `GEMINI_API_KEY` | Yes* | Gemini API key (*if using Gemini) |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Firebase client config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase client config |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase client config |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Firebase client config |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase client config |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | Firebase client config |
| `FIREBASE_ADMIN_PROJECT_ID` | Yes | Firebase Admin SDK |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Yes | Firebase Admin SDK |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Yes | Firebase Admin SDK (include `\n`) |
| `NEXTAUTH_URL` | Yes | App URL (e.g. `https://generaciaassistent.vercel.app`) |
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth app client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth app client secret |
| `ALLOWED_EMAIL_DOMAIN` | No | Restrict login to one domain (e.g. `react.com.ua`) |
| `GOOGLE_DRIVE_FOLDER_ID` | No | Drive folder ID for sync |
| `NOTION_TOKEN` | No | Notion integration token |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret for Telegram webhook verification |
| `TELEGRAM_ALLOWED_USERS` | No | Comma-separated Telegram usernames (env fallback) |
| `CRON_SECRET` | No | Bearer token for cron endpoint |

---

## 17. Key Thresholds & Constants

| Constant | Value | Location |
|---|---|---|
| Chunk threshold | 60,000 tokens / 240,000 chars | `chunker.ts` |
| Chunk size | 200,000 chars (~50k tokens) | `chunker.ts` |
| Chunk overlap | 5,000 chars | `chunker.ts` |
| Max chunks per context | 3 per parent | `document-selector.ts` |
| Claude token budget | 100,000 tokens | `document-selector.ts` |
| Gemini token budget | 250,000 tokens | `document-selector.ts` |
| Per-doc hard cap | 60,000 tokens | `document-selector.ts` |
| Conversation cache TTL | 5 minutes | `document-selector.ts` |
| System prompt cache TTL | 60 seconds | `system-prompt.ts` |
| Max spreadsheet rows | 2,000 per sheet | `parsers.ts` |
| Firestore batch size | 400 ops | `chunker.ts` |
| Max file upload size | 10 MB | `admin/upload/route.ts` |
| Telegram message limit | 4,096 chars | `bot/telegram/route.ts` |

---

## 18. Deployment

### Vercel Setup

The project is deployed on Vercel with two environments:

| Environment | URL | Branch |
|---|---|---|
| Production | https://generaciaassistent.vercel.app | `main` |
| Dev/Preview | https://generacia-dev.vercel.app | feature branches |

### Deploy to Dev

```bash
./scripts/deploy-dev.sh
```

This runs `vercel` (preview mode) and updates the stable `generacia-dev.vercel.app` alias.

### Deploy to Production

```bash
vercel --prod
```

Only run after PR is merged to `main`.

### Development Workflow

```
1. git checkout -b feature/my-feature
2. # make changes
3. ./scripts/deploy-dev.sh     # test on generacia-dev.vercel.app
4. gh pr create                # open PR
5. # review & approve
6. gh pr merge --squash        # merge to main
7. vercel --prod               # deploy to production
```

### Firestore Indexes

Required indexes are in `firestore.indexes.json`. Deploy with:
```bash
firebase deploy --only firestore:indexes
```

### Telegram Webhook Registration

After deploying to a new URL, re-register the webhook:
```bash
curl "https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url=https://generaciaassistent.vercel.app/api/bot/telegram&secret_token={WEBHOOK_SECRET}"
```

### Making a User Admin

```bash
npx ts-node scripts/make-admin.ts user@company.com
```
