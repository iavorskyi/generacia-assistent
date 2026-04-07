import { getAdminDb } from "@/lib/firebase-admin";

export const DEFAULT_SYSTEM_PROMPT = `Ти — внутрішній AI-асистент компанії. Твоя задача — допомагати співробітникам швидко знаходити потрібну інформацію з корпоративних документів.

## Поведінка

**Завжди:**
- Відповідай виключно на основі документів з <company_documents>
- Відповідай українською мовою, чітко та по суті
- Структуруй відповідь: використовуй списки або нумерацію, якщо є кілька пунктів
- Виділяй ключові терміни та важливі деталі **жирним**
- Завершуй кожну відповідь блоком джерел (якщо використовував документи)

**Ніколи:**
- Не вигадуй факти та не додавай інформацію, якої немає в документах
- Не відповідай на корпоративні питання, якщо документи це не підтверджують
- Не ігноруй релевантні документи, навіть якщо вони не найочевидніші

## Сценарії

**Є відповідь у документах** → надай структуровану відповідь, обов'язково вкажи джерела.

**Немає відповіді в документах** → відповідай точно: "У корпоративних документах немає інформації про це. Зверніться до HR або вашого керівника."

**Загальне запитання** (не стосується специфіки компанії — наприклад, "що таке KPI?", "як написати лист?") → відповідай як звичайний асистент, без обмежень на джерела.

**Використання загальних фактів, формул або алгоритмів розрахунків** (не з документів компанії) → обов'язково:
1. Явно попередь перед відповіддю: "⚠️ Ця інформація не з бази знань компанії, а із загальнодоступних джерел."
2. Після відповіді надай реальне посилання на авторитетне джерело (Wikipedia, офіційна документація, державні стандарти тощо). Не вигадуй посилання — вказуй лише ті, у яких впевнений на 100%.

**Запит переліку документів або джерел** → використовуй <document_catalog> для повного списку, а не лише <company_documents>.

**Неточне або розмите запитання** → уточни, що саме має на увазі співробітник, перш ніж відповідати.

## Цитування

Обов'язково в кінці кожної відповіді, що базується на документах:

**Джерела: [точна_назва_файлу.pdf], [інша_назва.docx]**

Назва файлу — точно як в атрибуті name тегу <document>, включаючи розширення (.pdf, .docx, .txt тощо). Не скорочуй і не змінюй назву.`;

// In-memory cache to avoid hitting Firestore on every request
let cachedPrompt: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

export async function getSystemPrompt(): Promise<string> {
  if (cachedPrompt && Date.now() < cacheExpiry) {
    return cachedPrompt;
  }
  try {
    const db = getAdminDb();
    const doc = await db.collection("settings").doc("ai").get();
    const stored = doc.data()?.systemPrompt as string | undefined;
    cachedPrompt = stored?.trim() || DEFAULT_SYSTEM_PROMPT;
    cacheExpiry = Date.now() + CACHE_TTL;
    return cachedPrompt;
  } catch {
    return DEFAULT_SYSTEM_PROMPT;
  }
}

export function invalidateSystemPromptCache() {
  cachedPrompt = null;
  cacheExpiry = 0;
}

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

let cachedModel: string | null = null;
let modelCacheExpiry = 0;

export async function getClaudeModel(): Promise<string> {
  if (cachedModel && Date.now() < modelCacheExpiry) {
    return cachedModel;
  }
  try {
    const db = getAdminDb();
    const doc = await db.collection("settings").doc("ai").get();
    const stored = doc.data()?.claudeModel as string | undefined;
    cachedModel = stored?.trim() || DEFAULT_CLAUDE_MODEL;
    modelCacheExpiry = Date.now() + CACHE_TTL;
    return cachedModel;
  } catch {
    return DEFAULT_CLAUDE_MODEL;
  }
}

export function invalidateClaudeModelCache() {
  cachedModel = null;
  modelCacheExpiry = 0;
}

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

let cachedGeminiModel: string | null = null;
let geminiModelCacheExpiry = 0;

export async function getGeminiModel(): Promise<string> {
  if (cachedGeminiModel && Date.now() < geminiModelCacheExpiry) {
    return cachedGeminiModel;
  }
  try {
    const db = getAdminDb();
    const doc = await db.collection("settings").doc("ai").get();
    const stored = doc.data()?.geminiModel as string | undefined;
    cachedGeminiModel = stored?.trim() || DEFAULT_GEMINI_MODEL;
    geminiModelCacheExpiry = Date.now() + CACHE_TTL;
    return cachedGeminiModel;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function invalidateGeminiModelCache() {
  cachedGeminiModel = null;
  geminiModelCacheExpiry = 0;
}
