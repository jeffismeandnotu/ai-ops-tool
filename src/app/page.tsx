"use client";
import { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"chat" | "ops" | "auto">("chat");
  const [opsLog, setOpsLog] = useState("");
  const [autoResult, setAutoResult] = useState("");
  const [autoRunning, setAutoRunning] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (session) checkToken();
  }, [session]);

  const checkToken = async () => {
    const res = await fetch("/api/auth/token");
    const data = await res.json();
    setTokenSaved(data.hasToken);
  };

  const saveToken = async () => {
    await fetch("/api/auth/token", { method: "POST" });
    setTokenSaved(true);
  };

  const loadOps = async () => {
    const res = await fetch("/api/ops?view=summary");
    const data = await res.json();
    setOpsLog(data.summary || "No operations yet.");
  };

  const triggerAutomation = async () => {
    setAutoRunning(true);
    setAutoResult("Processing...");
    try {
      const res = await fetch("/api/cron/process", { method: "POST" });
      const data = await res.json();
      setAutoResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setAutoResult(`Error: ${err.message}`);
    }
    setAutoRunning(false);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">CleanBook AI</h1>
          <p className="text-gray-500 mb-8">Operations Assistant</p>
          <button
            onClick={() => signIn("google")}
            className="bg-blue-600 text-white px-8 py-3 rounded-xl text-lg font-medium hover:bg-blue-700 transition-colors w-full"
          >
            Sign in with Google
          </button>
          <p className="text-xs text-gray-400 mt-4">
            Connects to your Gmail and Google Calendar
          </p>
        </div>
      </div>
    );
  }

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMessage: Message = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      });
      const data = await res.json();
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: data.error ? `Error: ${data.error}` : data.response },
      ]);
    } catch (err: any) {
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">CleanBook AI</h1>
          <p className="text-sm text-gray-500">Operations Assistant</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
            {(["chat", "auto", "ops"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); if (t === "ops") loadOps(); }}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "chat" ? "Chat" : t === "auto" ? "Automation" : "Ops Log"}
              </button>
            ))}
          </div>
          <span className="text-sm text-gray-600">{session.user?.email}</span>
          <button onClick={() => signOut()} className="text-sm text-gray-500 hover:text-gray-700">
            Sign out
          </button>
        </div>
      </header>

      {tab === "chat" && (
        <>
          <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl w-full mx-auto">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 mt-20">
                <p className="text-lg mb-2">What would you like to do?</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {[
                    "Check today's schedule",
                    "Read my latest emails",
                    "Book a regular clean for Friday",
                    "Send reminders for tomorrow",
                    "Find available slots next week",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`mb-4 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                  msg.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-800"
                }`}>
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{msg.content}</pre>
                </div>
              </div>
            ))}
            {loading && (
              <div className="mb-4 flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t border-gray-200 bg-white px-6 py-4">
            <div className="max-w-4xl mx-auto flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask me to check emails, manage bookings, send reminders..."
                className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}

      {tab === "auto" && (
        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl w-full mx-auto">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Automation Control</h2>
            
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">1. Save Access Token</h3>
              <p className="text-sm text-gray-500 mb-3">
                Required for cron automation. Saves your Google token so the system can run without you logged in.
              </p>
              <button
                onClick={saveToken}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tokenSaved ? "bg-green-50 text-green-700 border border-green-200" : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {tokenSaved ? "Token Saved" : "Save Token for Automation"}
              </button>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">2. Run Automation Cycle</h3>
              <p className="text-sm text-gray-500 mb-3">
                Manually trigger the email processing cycle. In production, this runs every 5 minutes automatically.
              </p>
              <button
                onClick={triggerAutomation}
                disabled={autoRunning}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {autoRunning ? "Processing..." : "Run Now"}
              </button>
            </div>
          </div>

          {autoResult && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Result</h3>
              <pre className="text-sm text-gray-800 bg-gray-50 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
                {autoResult}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === "ops" && (
        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl w-full mx-auto">
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Operations Log</h2>
              <button
                onClick={loadOps}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Refresh
              </button>
            </div>
            <pre className="text-sm text-gray-800 bg-gray-50 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap font-mono">
              {opsLog || "Loading..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
