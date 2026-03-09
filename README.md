# Генерація — AI Assistant

An internal AI chatbot for the Генерація solar energy company. Built on a RAG (Retrieval-Augmented Generation) pipeline, it answers employee questions using the company's own documents and knowledge base.

**Production:** https://generaciaassistent.vercel.app
**Dev/Preview:** https://generacia-dev.vercel.app

---

## Features

- **RAG Chat** — answers questions by retrieving relevant documents from the knowledge base
- **Multiple document sources** — Google Drive, Notion, file uploads, web scraping
- **Two AI providers** — Claude Haiku (default) or Gemini 2.5 Flash, switchable from admin panel
- **Smart document chunking** — large documents split automatically for better retrieval
- **Telegram bot** — same chat pipeline accessible via Telegram
- **Admin panel** — manage documents, sync sources, view costs, manage users
- **Cost tracking** — daily token usage and spending by provider
- **Google OAuth** — login restricted to company email domain

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | Firebase Firestore |
| Auth | NextAuth.js v4 (Google OAuth) |
| AI | Anthropic Claude Haiku / Google Gemini 2.5 Flash |
| Hosting | Vercel |
| Storage | Google Drive, Notion API |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore enabled
- Google Cloud project with OAuth 2.0 credentials and Drive API enabled
- Anthropic API key and/or Google Gemini API key

### Installation

```bash
git clone https://github.com/iavorskyi/generacia-assistent.git
cd generacia-assistent
npm install
cp .env.local.example .env.local  # fill in your values
npm run dev
```

### Environment Variables

```env
# AI
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Firebase (client)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase (server)
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_EMAIL_DOMAIN=yourcompany.com

# Integrations
GOOGLE_DRIVE_FOLDER_ID=
NOTION_TOKEN=

# Telegram (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_USERS=
```

---

## Development Workflow

1. **Create a branch** for every change — never commit directly to `main`
2. **Deploy to dev** for testing: `./scripts/deploy-dev.sh` → https://generacia-dev.vercel.app
3. **Open a PR** before merging
4. **Merge to main** → deploy to production: `vercel --prod`

---

## Project Structure

```
app/
  page.tsx              # Chat UI
  admin/                # Admin panel (documents, costs, settings)
  api/
    chat/               # Main RAG endpoint
    admin/              # Drive sync, Notion sync, uploads, users
    bot/telegram/       # Telegram webhook
    conversations/      # Chat history
    cron/               # Website refresh cron job
lib/
  document-selector.ts  # RAG core: selects relevant docs
  chunker.ts            # Splits large documents into chunks
  parsers.ts            # PDF, DOCX, XLSX, TXT, MD parsing
  claude.ts / gemini.ts # AI provider integrations
  google-drive.ts       # Drive API
  notion.ts             # Notion API
  web-parser.ts         # Web scraping
scripts/                # Firestore maintenance scripts
types/                  # TypeScript types
```

---

## Admin Panel

Access at `/admin` (requires admin flag on your user account).

| Tab | Purpose |
|---|---|
| Documents | View all knowledge base documents, delete, bulk operations |
| Google Drive | Preview and sync files from configured Drive folder |
| Notion | Sync pages from connected Notion workspace |
| Веб-сайти | Add/remove website sources with optional crawling |
| Налаштування | Switch AI provider, edit system prompt |
| Користувачі | Grant/revoke admin access |
| Telegram | Manage allowed Telegram users |
| Витрати | Token usage and cost dashboard |
