"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  cacheStatus?: "hit" | "miss" | "created";
  timestamp: Date;
}

const SUGGESTED_QUESTIONS = [
  "Яка наша політика відпусток?",
  "Як подати звіт про витрати?",
  "Які процедури деплою в інженерії?",
  "Де знайти довідник працівника?",
];

export default function Home() {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [cacheHint, setCacheHint] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-white text-3xl font-bold">AI</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Асистент компанії
          </h1>
          <p className="text-gray-500 mb-8">
            Увійдіть з корпоративним акаунтом, щоб почати
          </p>
          <button
            onClick={() => signIn("google")}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg px-6 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Увійти через Google
          </button>
        </div>
      </div>
    );
  }

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setCacheHint(false);
    setSidebarOpen(false);
    inputRef.current?.focus();
  };

  const sendMessage = async (query: string) => {
    if (!query.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: query,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, conversationId }),
      });

      const text = await res.text();

      if (!text) {
        throw new Error("Сервер повернув порожню відповідь. Спробуйте ще раз.");
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Невірна відповідь від сервера. Спробуйте ще раз.");
      }

      if (!res.ok) {
        throw new Error(data.error || "Не вдалося отримати відповідь");
      }

      setConversationId(data.conversationId);
      setCacheHint(data.cacheStatus === "created" || data.cacheStatus === "hit");

      const assistantMessage: Message = {
        role: "assistant",
        content: data.answer,
        citations: data.citations,
        cacheStatus: data.cacheStatus,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        role: "assistant",
        content: `Вибачте, виникла помилка: ${error instanceof Error ? error.message : "Невідома помилка"}. Спробуйте ще раз.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const sidebarContent = (
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-sm font-bold">
            AI
          </div>
          <span className="font-semibold">Асистент компанії</span>
        </div>
        <button
          onClick={startNewChat}
          className="w-full bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 text-sm text-left transition-colors"
        >
          + Новий чат
        </button>
      </div>

      {cacheHint && (
        <div className="mx-3 mt-3 p-2 bg-green-900/40 border border-green-700 rounded-lg text-xs text-green-300">
          Кеш активний — додаткові питання на 90% дешевші!
        </div>
      )}

      <div className="flex-1" />

      <div className="p-4 border-t border-gray-700">
        {session.user.isAdmin && (
          <a
            href="/admin"
            className="block w-full text-center bg-gray-700 hover:bg-gray-600 rounded-lg px-3 py-2 text-sm mb-3 transition-colors"
          >
            Панель адміністратора
          </a>
        )}
        <div className="flex items-center gap-2 mb-2">
          {session.user.image && (
            <img src={session.user.image} alt="" className="w-7 h-7 rounded-full" />
          )}
          <span className="text-sm text-gray-300 truncate flex-1">
            {session.user.email}
          </span>
        </div>
        <button
          onClick={() => signOut()}
          className="w-full text-xs text-gray-400 hover:text-white transition-colors text-left"
        >
          Вийти
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex bg-gray-50" style={{ height: "100dvh" }}>
      {/* Sidebar — desktop */}
      <div className="hidden md:flex flex-col w-64 shrink-0">
        {sidebarContent}
      </div>

      {/* Sidebar — mobile overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="flex flex-col w-64 shrink-0 z-50">
            {sidebarContent}
          </div>
          <div
            className="flex-1 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="w-6 h-6 bg-blue-500 rounded-md flex items-center justify-center text-white text-xs font-bold">AI</div>
          <span className="font-medium text-gray-800 text-sm">Асистент компанії</span>
          <div className="flex-1" />
          <button
            onClick={startNewChat}
            className="text-xs text-blue-600 font-medium"
          >
            + Новий
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto mt-16 text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <span className="text-blue-600 text-2xl font-bold">AI</span>
              </div>
              <h2 className="text-2xl font-semibold text-gray-800 mb-2">
                Чим я можу вам допомогти?
              </h2>
              <p className="text-gray-500 mb-8">
                Запитайте мене про політики компанії, процедури та документацію.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-left bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors shadow-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] ${msg.role === "user" ? "order-2" : "order-1"}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                          AI
                        </div>
                        <span className="text-xs text-gray-400">
                          Асистент компанії
                          {msg.cacheStatus === "hit" && (
                            <span className="ml-2 text-green-500">⚡ cached</span>
                          )}
                        </span>
                      </div>
                    )}
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-white border border-gray-200 text-gray-800 shadow-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {msg.content}
                      </p>
                    </div>
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {msg.citations.map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {msg.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                      <div
                        className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.4s" }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-gray-200 bg-white px-4 pt-3 pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 items-end bg-gray-50 border border-gray-300 rounded-2xl px-4 py-3 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Задайте питання..."
                rows={1}
                className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none resize-none max-h-32"
                style={{ minHeight: "24px" }}
                disabled={loading}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className="shrink-0 w-8 h-8 flex items-center justify-center bg-blue-600 text-white rounded-xl disabled:opacity-40 hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
            <p className="hidden md:block text-xs text-gray-400 text-center mt-2">
              Відповіді базуються лише на документах компанії. Натисніть Enter для відправки.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
