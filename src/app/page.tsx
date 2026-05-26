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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => { if (session) checkToken(); }, [session]);

  const checkToken = async () => { try { const r = await fetch("/api/auth/token"); const d = await r.json(); setTokenSaved(d.hasToken); } catch {} };
  const saveToken = async () => { await fetch("/api/auth/token", { method: "POST" }); setTokenSaved(true); };
  const loadOps = async () => { const r = await fetch("/api/ops?view=summary"); const d = await r.json(); setOpsLog(d.summary || "No operations yet."); };

  const triggerAutomation = async () => {
    setAutoRunning(true); setAutoResult("Processing...");
    try { const r = await fetch("/api/cron/process", { method: "POST" }); const d = await r.json(); setAutoResult(JSON.stringify(d, null, 2)); }
    catch (e: any) { setAutoResult(`Error: ${e.message}`); }
    setAutoRunning(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated); setInput(""); setLoading(true);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: updated }) });
      const d = await r.json();
      setMessages([...updated, { role: "assistant", content: d.error ? `Error: ${d.error}` : d.response }]);
    } catch (e: any) { setMessages([...updated, { role: "assistant", content: `Error: ${e.message}` }]); }
    setLoading(false);
  };

  if (status === "loading") return (
    <div className="h-full flex items-center justify-center" style={{ background: "var(--bg-surface)" }}>
      <div className="dot-pulse flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--accent)" }} />
      </div>
    </div>
  );

  if (!session) return (
    <div className="h-full flex items-center justify-center px-6" style={{ background: "var(--bg-surface)" }}>
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: "var(--accent-light)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
        </div>
        <h1 className="text-xl font-semibold mb-0.5" style={{ color: "var(--text-primary)" }}>Glow Cleaning</h1>
        <p className="text-sm mb-7" style={{ color: "var(--text-muted)" }}>Operations Dashboard</p>
        <button onClick={() => signIn("google")} className="w-full py-3 rounded-full text-sm font-medium transition-all active:scale-[0.98]" style={{ background: "var(--accent)", color: "#fff", boxShadow: "var(--shadow-md)" }}>
          Sign in with Google
        </button>
        <p className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>Connects to Gmail & Calendar</p>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-surface)" }}>

      {/* Header */}
      <header className="safe-top flex items-center justify-between px-4 py-3 z-50" style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "var(--accent-light)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
          </div>
          <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Glow Cleaning</span>
        </div>
        <button onClick={() => setShowMenu(!showMenu)} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: showMenu ? "var(--bg-elevated)" : "transparent" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
        </button>
      </header>

      {/* Menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute top-[60px] right-3 z-50 rounded-2xl py-1 shadow-lg" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", minWidth: "220px", boxShadow: "var(--shadow-lg)" }}>
            <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{session.user?.email}</p>
            </div>
            <button onClick={() => { saveToken(); setShowMenu(false); }} className="w-full text-left px-4 py-3 text-sm" style={{ color: tokenSaved ? "var(--success)" : "var(--text-primary)" }}>
              {tokenSaved ? "Token saved" : "Save access token"}
            </button>
            <button onClick={() => { signOut(); setShowMenu(false); }} className="w-full text-left px-4 py-3 text-sm" style={{ color: "var(--danger)" }}>Sign out</button>
          </div>
        </>
      )}

      {/* Tabs */}
      <div className="flex px-4 pt-2 pb-1" style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
        {([ { id: "chat" as const, label: "Chat" }, { id: "auto" as const, label: "Automation" }, { id: "ops" as const, label: "Log" } ]).map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === "ops") loadOps(); setShowMenu(false); }}
            className="flex-1 pb-2.5 text-[13px] font-medium transition-colors relative"
            style={{ color: tab === t.id ? "var(--accent)" : "var(--text-muted)" }}>
            {t.label}
            {tab === t.id && <span className="absolute bottom-0 left-1/4 right-1/4 h-[2.5px] rounded-full" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      {/* Chat */}
      {tab === "chat" && (
        <>
          <div className="flex-1 overflow-y-auto chat-scroll hide-scrollbar px-4 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-2">
                <div className="w-12 h-12 rounded-full mb-4 flex items-center justify-center" style={{ background: "var(--accent-light)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </div>
                <p className="text-[15px] font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>How can I help?</p>
                <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>Manage emails, bookings & schedule</p>
                <div className="flex flex-wrap justify-center gap-2 w-full max-w-sm">
                  {["Check today's schedule", "Read new emails", "Available slots this week", "Send reminders"].map((q) => (
                    <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      className="py-2 px-3.5 rounded-full text-[12px] transition-all active:scale-[0.97]"
                      style={{ background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`mb-2.5 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-[20px] px-3.5 py-2.5 ${msg.role === "user" ? "" : ""}`}
                  style={{
                    background: msg.role === "user" ? "var(--user-bubble)" : "var(--assistant-bubble)",
                    color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                    borderBottomRightRadius: msg.role === "user" ? "4px" : undefined,
                    borderBottomLeftRadius: msg.role === "assistant" ? "4px" : undefined,
                  }}>
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-[1.45]">{msg.content}</pre>
                </div>
              </div>
            ))}
            {loading && (
              <div className="mb-2.5 flex justify-start">
                <div className="rounded-[20px] px-4 py-3" style={{ background: "var(--assistant-bubble)", borderBottomLeftRadius: "4px" }}>
                  <div className="dot-pulse flex gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-muted)" }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-muted)" }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-muted)" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="safe-bottom px-3 py-2" style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
            <div className="flex gap-2 items-center">
              <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Message..."
                className="flex-1 py-2.5 px-4 rounded-full text-[14px]"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                disabled={loading} />
              <button onClick={sendMessage} disabled={loading || !input.trim()}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-[0.9]"
                style={{ background: input.trim() ? "var(--accent)" : "var(--bg-input)", border: input.trim() ? "none" : "1px solid var(--border)" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill={input.trim() ? "#fff" : "none"} stroke={input.trim() ? "#fff" : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Automation */}
      {tab === "auto" && (
        <div className="flex-1 overflow-y-auto chat-scroll hide-scrollbar px-4 py-4">
          <div className="rounded-2xl p-5 mb-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <h2 className="text-[15px] font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Automation</h2>
            <div className="mb-5">
              <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Access Token</p>
              <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>Required for automated email processing</p>
              <button onClick={saveToken} className="w-full py-2.5 rounded-full text-[13px] font-medium transition-all active:scale-[0.98]"
                style={{ background: tokenSaved ? "#E6F4EA" : "var(--accent)", color: tokenSaved ? "var(--success)" : "#fff", border: tokenSaved ? "1px solid #CEEAD6" : "none" }}>
                {tokenSaved ? "Token saved" : "Save Token"}
              </button>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Process Emails</p>
              <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>Read new emails, classify, and take action</p>
              <button onClick={triggerAutomation} disabled={autoRunning}
                className="w-full py-2.5 rounded-full text-[13px] font-medium transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}>
                {autoRunning ? "Processing..." : "Run Now"}
              </button>
            </div>
          </div>
          {autoResult && (
            <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Result</p>
              <pre className="text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{autoResult}</pre>
            </div>
          )}
        </div>
      )}

      {/* Ops Log */}
      {tab === "ops" && (
        <div className="flex-1 overflow-y-auto chat-scroll hide-scrollbar px-4 py-4">
          <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Operations Log</p>
              <button onClick={loadOps} className="text-xs py-1 px-3 rounded-full transition-all active:scale-[0.95]"
                style={{ color: "var(--accent)", background: "var(--accent-light)" }}>Refresh</button>
            </div>
            <pre className="text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono" style={{ color: "var(--text-secondary)" }}>{opsLog || "Loading..."}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
