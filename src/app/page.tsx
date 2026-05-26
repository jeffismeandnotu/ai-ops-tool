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
  const [tab, setTab] = useState<"chat" | "auto" | "ops">("chat");
  const [opsLog, setOpsLog] = useState("");
  const [autoResult, setAutoResult] = useState("");
  const [autoRunning, setAutoRunning] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (session) checkToken();
  }, [session]);

  const checkToken = async () => {
    try {
      const res = await fetch("/api/auth/token");
      const data = await res.json();
      setTokenSaved(data.hasToken);
    } catch {}
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
    setAutoResult("Processing emails...");
    try {
      const res = await fetch("/api/cron/process", { method: "POST" });
      const data = await res.json();
      setAutoResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setAutoResult(`Error: ${err.message}`);
    }
    setAutoRunning(false);
  };

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

  // --- Loading State ---
  if (status === "loading") {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="dot-pulse flex gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: "var(--accent)" }} />
          <span className="w-3 h-3 rounded-full" style={{ background: "var(--accent)" }} />
          <span className="w-3 h-3 rounded-full" style={{ background: "var(--accent)" }} />
        </div>
      </div>
    );
  }

  // --- Sign In ---
  if (!session) {
    return (
      <div className="h-full flex items-center justify-center px-6" style={{ background: "var(--bg-primary)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center" style={{ background: "var(--accent-glow)", border: "1px solid var(--accent)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Glow Cleaning</h1>
          <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>Operations Dashboard</p>
          <button
            onClick={() => signIn("google")}
            className="w-full py-3.5 rounded-2xl text-base font-medium transition-all active:scale-[0.98]"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            Sign in with Google
          </button>
          <p className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>
            Connects to Gmail & Calendar
          </p>
        </div>
      </div>
    );
  }

  // --- Main App ---
  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-primary)" }}>
      {/* Header */}
      <header
        className="glass safe-top flex items-center justify-between px-4 py-3 z-50"
        style={{ background: "rgba(11, 15, 26, 0.85)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-glow)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>Glow Cleaning</h1>
            <p className="text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>Operations</p>
          </div>
        </div>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ background: showMenu ? "var(--bg-elevated)" : "transparent" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </header>

      {/* Dropdown Menu */}
      {showMenu && (
        <div className="absolute top-16 right-3 z-50 rounded-2xl p-1.5 shadow-2xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", minWidth: "200px" }}>
          <div className="px-3 py-2 mb-1" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{session.user?.email}</p>
          </div>
          <button onClick={() => { saveToken(); setShowMenu(false); }} className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors hover:bg-white/5" style={{ color: tokenSaved ? "var(--success)" : "var(--text-primary)" }}>
            {tokenSaved ? "✓ Token Saved" : "Save Access Token"}
          </button>
          <button onClick={() => { signOut(); setShowMenu(false); }} className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors hover:bg-white/5" style={{ color: "var(--danger)" }}>
            Sign Out
          </button>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex px-4 py-2 gap-1" style={{ background: "var(--bg-primary)" }}>
        {([
          { id: "chat" as const, label: "Chat", icon: "💬" },
          { id: "auto" as const, label: "Automation", icon: "⚡" },
          { id: "ops" as const, label: "Ops Log", icon: "📋" },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); if (t.id === "ops") loadOps(); setShowMenu(false); }}
            className="flex-1 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-[0.97]"
            style={{
              background: tab === t.id ? "var(--bg-card)" : "transparent",
              color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
              border: tab === t.id ? "1px solid var(--border-light)" : "1px solid transparent",
            }}
          >
            <span className="mr-1">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Chat Tab */}
      {tab === "chat" && (
        <>
          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto chat-scroll hide-scrollbar px-4 py-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 rounded-2xl mb-5 flex items-center justify-center" style={{ background: "var(--accent-glow)" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-base font-medium mb-1" style={{ color: "var(--text-primary)" }}>How can I help?</p>
                <p className="text-xs mb-6" style={{ color: "var(--text-muted)" }}>Manage emails, bookings & schedule</p>
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  {[
                    "Check today's schedule",
                    "Read new emails",
                    "Find available slots this week",
                    "Send reminders for tomorrow",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      className="w-full py-3 rounded-xl text-sm text-left px-4 transition-all active:scale-[0.98]"
                      style={{ background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-4 py-3"
                  style={{
                    background: msg.role === "user" ? "var(--user-bubble)" : "var(--assistant-bubble)",
                    color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                    border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
                    borderBottomRightRadius: msg.role === "user" ? "6px" : undefined,
                    borderBottomLeftRadius: msg.role === "assistant" ? "6px" : undefined,
                  }}
                >
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{msg.content}</pre>
                </div>
              </div>
            ))}

            {loading && (
              <div className="mb-3 flex justify-start">
                <div className="rounded-2xl px-4 py-3" style={{ background: "var(--assistant-bubble)", border: "1px solid var(--border)", borderBottomLeftRadius: "6px" }}>
                  <div className="dot-pulse flex gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
                    <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div className="safe-bottom px-3 py-2" style={{ background: "rgba(11, 15, 26, 0.95)", borderTop: "1px solid var(--border)" }}>
            <div className="flex gap-2 items-end">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Message..."
                className="flex-1 py-3 px-4 rounded-2xl text-sm"
                style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)", caretColor: "var(--accent)" }}
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-all active:scale-[0.92]"
                style={{ background: input.trim() ? "var(--accent)" : "var(--bg-card)", border: input.trim() ? "none" : "1px solid var(--border)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#fff" : "var(--text-muted)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Automation Tab */}
      {tab === "auto" && (
        <div className="flex-1 overflow-y-auto chat-scroll hide-scrollbar px-4 py-4">
          <div className="rounded-2xl p-5 mb-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Automation</h2>

            <div className="mb-5">
              <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Access Token</p>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Required for automated email processing</p>
              <button
                onClick={saveToken}
                className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
                style={{
                  background: tokenSaved ? "rgba(16, 185, 129, 0.1)" : "var(--accent)",
                  color: tokenSaved ? "var(--success)" : "#fff",
                  border: tokenSaved ? "1px solid rgba(16, 185, 129, 0.3)" : "none",
                }}
              >
                {tokenSaved ? "✓ Token Saved" : "Save Token"}
              </button>
            </div>

            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Process Emails</p>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Reads new emails, classifies, and takes action</p>
              <button
                onClick={triggerAutomation}
                disabled={autoRunning}
                className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {autoRunning ? "Processing..." : "⚡ Run Now"}
              </button>
            </div>
          </div>

          {autoResult && (
            <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Result</p>
              <pre className="text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                {autoResult}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Ops Log Tab */}
      {tab === "ops" && (
        <div className="flex-1 overflow-y-auto chat-scroll hide-scrollbar px-4 py-4">
          <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Operations Log</p>
              <button
                onClick={loadOps}
                className="text-xs px-3 py-1.5 rounded-lg transition-all active:scale-[0.95]"
                style={{ color: "var(--accent)", background: "var(--accent-glow)" }}
              >
                Refresh
              </button>
            </div>
            <pre className="text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono" style={{ color: "var(--text-secondary)" }}>
              {opsLog || "Loading..."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
