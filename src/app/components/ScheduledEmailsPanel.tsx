"use client";
import { useState, useEffect, useCallback, useRef } from "react";

interface Template {
  id: string;
  name: string;
  subject: string;
}

interface Recipient {
  id: string;
  email: string;
  firstName: string;
  active: boolean;
  optedOut: boolean;
  status: string;
}

interface ScheduledCampaign {
  id: string;
  name: string;
  templateId: string;
  audience: string;
  recipientIds: string[] | null;
  sendAt: string;
  mode: string;
  status: string;
}

interface PreviewData {
  subject: string;
  body: string;
}

const api = async (path: string, opts?: RequestInit) => {
  const r = await fetch(path, opts);
  return r.json();
};

const postJson = (path: string, body: unknown) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export default function ScheduledEmailsPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [campaigns, setCampaigns] = useState<ScheduledCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const [formName, setFormName] = useState("");
  const [formTemplate, setFormTemplate] = useState("");
  const [formDateTime, setFormDateTime] = useState("");
  const [formMode, setFormMode] = useState<"preview" | "test" | "live">("test");
  const [formBusy, setFormBusy] = useState(false);

  const [addEmail, setAddEmail] = useState("");
  const [addFirstName, setAddFirstName] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewRecipientId, setPreviewRecipientId] = useState("");

  const [runResult, setRunResult] = useState("");
  const [runBusy, setRunBusy] = useState(false);

  const [section, setSection] = useState<"campaigns" | "recipients" | "create">("campaigns");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r, c] = await Promise.all([
        api("/api/campaigns?action=templates"),
        api("/api/campaigns?action=recipients"),
        api("/api/campaigns?action=scheduled"),
      ]);
      setTemplates(t.templates || []);
      setRecipients(r.recipients || []);
      setCampaigns(c.campaigns || []);
      if (!formTemplate && t.templates?.length) {
        setFormTemplate(t.templates[0].id);
      }
    } catch {}
    setLoading(false);
  }, [formTemplate]);

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (selectAll) {
      const active = recipients.filter((r) => r.active && !r.optedOut);
      setSelectedRecipients(new Set(active.map((r) => r.id)));
    } else if (selectedRecipients.size === recipients.filter((r) => r.active && !r.optedOut).length && selectedRecipients.size > 0) {
      setSelectedRecipients(new Set());
    }
  }, [selectAll]);

  const toggleRecipient = (id: string) => {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectAll(false);
  };

  const handleAddRecipient = async () => {
    if (!addEmail.trim()) return;
    setAddBusy(true);
    await postJson("/api/campaigns?action=add-recipient", {
      email: addEmail.trim(),
      firstName: addFirstName.trim(),
    });
    setAddEmail("");
    setAddFirstName("");
    setAddBusy(false);
    reload();
  };

  const handleRemoveRecipient = async (email: string) => {
    await postJson("/api/campaigns?action=remove-recipient", { email });
    reload();
  };

  const handleSchedule = async () => {
    if (!formName.trim() || !formTemplate || !formDateTime) return;
    setFormBusy(true);
    const audience = selectAll || selectedRecipients.size === 0 ? "all" : "selected";
    const recipientIds = audience === "selected" ? Array.from(selectedRecipients) : undefined;
    await postJson("/api/campaigns?action=schedule", {
      name: formName.trim(),
      templateId: formTemplate,
      audience,
      recipientIds,
      sendAt: new Date(formDateTime).toISOString(),
      mode: formMode,
    });
    setFormName("");
    setFormDateTime("");
    setFormBusy(false);
    setSection("campaigns");
    reload();
  };

  const handleCancel = async (id: string) => {
    await postJson("/api/campaigns?action=cancel", { id });
    reload();
  };

  const handleClearHistory = async () => {
    await postJson("/api/campaigns?action=clear-history", {});
    setRunResult("");
    reload();
  };

  const handlePreview = async () => {
    if (!formTemplate) return;
    const rid = previewRecipientId || (recipients.length > 0 ? recipients[0].id : "");
    const d = await api(
      `/api/campaigns?action=preview&template=${formTemplate}${rid ? `&recipient=${rid}` : ""}`
    );
    setPreview(d.preview || null);
  };

  const handleRunNow = async (id: string, mode: string) => {
    setRunBusy(true);
    setRunResult("Running...");
    try {
      const d = await api(`/api/campaigns?action=run&id=${id}&mode=${mode}`, { method: "POST" });
      if (d.error) {
        setRunResult(`Error: ${d.error}`);
      } else {
        const sent = d.results?.filter((r: any) => r.status === "sent").length || 0;
        const previewed = d.results?.filter((r: any) => r.status === "preview").length || 0;
        setRunResult(
          mode === "preview"
            ? `Preview: ${previewed} email(s) rendered`
            : `${sent} email(s) sent in ${mode} mode`
        );
      }
      reload();
    } catch (e: any) {
      setRunResult(`Error: ${e.message}`);
    }
    setRunBusy(false);
  };

  const liveLocked = true;

  const cardStyle = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)",
  };

  const pillBtn = (active: boolean) => ({
    background: active ? "var(--accent)" : "var(--bg-elevated)",
    color: active ? "#fff" : "var(--text-secondary)",
    border: active ? "none" : "1px solid var(--border)",
  });

  const statusColor = (s: string) => {
    if (s === "scheduled") return "var(--accent)";
    if (s === "sent") return "var(--success)";
    if (s === "cancelled") return "var(--text-muted)";
    if (s === "error") return "var(--danger)";
    return "var(--text-secondary)";
  };

  const modeLabel = (m: string) => {
    if (m === "preview") return "Preview";
    if (m === "test") return "Test";
    if (m === "live") return "Live";
    return m;
  };

  if (loading) {
    return (
      <div className="rounded-2xl p-5 mt-3" style={cardStyle}>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading campaigns...</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {/* Mode Banner */}
      <div
        className="rounded-2xl px-4 py-3 flex items-center gap-2"
        style={{
          background: "var(--accent-light)",
          border: "1px solid var(--accent)",
          borderColor: "rgba(26,115,232,0.2)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
          Demo mode — sends go to test address only. Live sending is disabled.
        </p>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1.5">
        {([
          { id: "campaigns" as const, label: "Scheduled" },
          { id: "recipients" as const, label: "Recipients" },
          { id: "create" as const, label: "New" },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className="py-1.5 px-3.5 rounded-full text-[12px] font-medium transition-all active:scale-[0.97]"
            style={pillBtn(section === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Scheduled Campaigns */}
      {section === "campaigns" && (
        <div className="rounded-2xl p-4" style={cardStyle}>
          <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Scheduled Emails
          </h3>

          {campaigns.length === 0 ? (
            <p className="text-[12px] py-4 text-center" style={{ color: "var(--text-muted)" }}>
              No scheduled emails yet
            </p>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => {
                const tpl = templates.find((t) => t.id === c.templateId);
                return (
                  <div
                    key={c.id}
                    className="rounded-xl p-3"
                    style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                          {c.name}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {tpl?.name || c.templateId} · {c.audience === "all" ? "All recipients" : `${c.recipientIds?.length || 0} selected`}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {new Date(c.sendAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            color: statusColor(c.status),
                            background:
                              c.status === "scheduled"
                                ? "var(--accent-light)"
                                : c.status === "sent"
                                ? "#E6F4EA"
                                : c.status === "error"
                                ? "#FEEAE6"
                                : "var(--bg-elevated)",
                          }}
                        >
                          {c.status}
                        </span>
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ color: "var(--text-secondary)", background: "var(--bg-elevated)" }}
                        >
                          {modeLabel(c.mode)}
                        </span>
                      </div>
                    </div>
                    {c.status === "scheduled" && (
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => handleRunNow(c.id, "preview")}
                          disabled={runBusy}
                          className="text-[11px] font-medium py-1 px-2.5 rounded-full transition-all active:scale-[0.95] disabled:opacity-50"
                          style={{ color: "var(--accent)", background: "var(--accent-light)" }}
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => handleRunNow(c.id, "test")}
                          disabled={runBusy}
                          className="text-[11px] font-medium py-1 px-2.5 rounded-full transition-all active:scale-[0.95] disabled:opacity-50"
                          style={{ color: "#fff", background: "var(--accent)" }}
                        >
                          Run now (test)
                        </button>
                        <button
                          onClick={() => handleCancel(c.id)}
                          className="text-[11px] font-medium py-1 px-2.5 rounded-full transition-all active:scale-[0.95]"
                          style={{ color: "var(--danger)", background: "#FEEAE6" }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {runResult && (
            <p className="text-[11px] mt-3 px-1" style={{ color: "var(--text-secondary)" }}>
              {runResult}
            </p>
          )}

          {campaigns.some((c) => c.status !== "scheduled") && (
            <button
              onClick={handleClearHistory}
              className="text-[11px] font-medium mt-3 py-1.5 px-3 rounded-full transition-all active:scale-[0.95]"
              style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              Clear history
            </button>
          )}
        </div>
      )}

      {/* Recipients */}
      {section === "recipients" && (
        <div className="rounded-2xl p-4" style={cardStyle}>
          <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Recipients
          </h3>

          {/* Add */}
          <div className="flex gap-2 mb-3">
            <input
              type="email"
              placeholder="Email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              className="flex-1 py-2 px-3 rounded-xl text-[12px]"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
            <input
              type="text"
              placeholder="Name"
              value={addFirstName}
              onChange={(e) => setAddFirstName(e.target.value)}
              className="w-24 py-2 px-3 rounded-xl text-[12px]"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
            <button
              onClick={handleAddRecipient}
              disabled={addBusy || !addEmail.trim()}
              className="py-2 px-3 rounded-xl text-[12px] font-medium transition-all active:scale-[0.95] disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Add
            </button>
          </div>

          {/* Select all */}
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={(e) => setSelectAll(e.target.checked)}
              className="rounded"
            />
            <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              Select all ({recipients.filter((r) => r.active && !r.optedOut).length})
            </span>
          </label>

          {/* List */}
          <div className="space-y-1">
            {recipients.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{
                  background: selectedRecipients.has(r.id) ? "var(--accent-light)" : "transparent",
                  opacity: !r.active || r.optedOut ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedRecipients.has(r.id)}
                  onChange={() => toggleRecipient(r.id)}
                  disabled={!r.active || r.optedOut}
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] truncate" style={{ color: "var(--text-primary)" }}>
                    {r.firstName || r.email}
                    {r.firstName && (
                      <span className="ml-1" style={{ color: "var(--text-muted)" }}>
                        {r.email}
                      </span>
                    )}
                  </p>
                </div>
                {r.status !== "ok" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--danger)", background: "#FEEAE6" }}>
                    {r.status}
                  </span>
                )}
                {r.optedOut && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--warning)", background: "#FEF7E0" }}>
                    opted out
                  </span>
                )}
                {r.active && !r.optedOut && (
                  <button
                    onClick={() => handleRemoveRecipient(r.email)}
                    className="text-[10px] px-1.5 py-0.5 rounded-full transition-all active:scale-[0.95]"
                    style={{ color: "var(--text-muted)", background: "var(--bg-elevated)" }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create / Schedule */}
      {section === "create" && (
        <div className="rounded-2xl p-4" style={cardStyle}>
          <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Schedule an Email
          </h3>

          <div className="space-y-3">
            {/* Name */}
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
                Campaign name
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. June reminders"
                className="w-full py-2 px-3 rounded-xl text-[13px]"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              />
            </div>

            {/* Template */}
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
                Template
              </label>
              <select
                value={formTemplate}
                onChange={(e) => { setFormTemplate(e.target.value); setPreview(null); }}
                className="w-full py-2 px-3 rounded-xl text-[13px]"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.subject}
                  </option>
                ))}
              </select>
            </div>

            {/* Recipients */}
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
                Recipients
              </label>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {selectAll || selectedRecipients.size === 0
                  ? `All active (${recipients.filter((r) => r.active && !r.optedOut).length})`
                  : `${selectedRecipients.size} selected`}
                {" "}<span
                  className="underline cursor-pointer"
                  style={{ color: "var(--accent)" }}
                  onClick={() => setSection("recipients")}
                >
                  change
                </span>
              </p>
            </div>

            {/* Date/Time */}
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
                Send at
              </label>
              <input
                ref={dateInputRef}
                type="datetime-local"
                value={formDateTime}
                onChange={(e) => setFormDateTime(e.target.value)}
                onClick={() => { try { dateInputRef.current?.showPicker(); } catch {} }}
                className="w-full py-2 px-3 rounded-xl text-[13px] cursor-pointer"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              />
            </div>

            {/* Mode */}
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>
                Mode
              </label>
              <div className="flex gap-1.5">
                {(["preview", "test", "live"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => m !== "live" && setFormMode(m)}
                    disabled={m === "live" && liveLocked}
                    className="flex-1 py-2 rounded-xl text-[12px] font-medium transition-all active:scale-[0.97] disabled:opacity-40"
                    style={pillBtn(formMode === m)}
                  >
                    {m === "live" ? "Live (disabled)" : modeLabel(m)}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="flex gap-2">
              <button
                onClick={handlePreview}
                className="flex-1 py-2 rounded-xl text-[12px] font-medium transition-all active:scale-[0.95]"
                style={{ color: "var(--accent)", background: "var(--accent-light)", border: "1px solid rgba(26,115,232,0.2)" }}
              >
                Preview email
              </button>
              <select
                value={previewRecipientId}
                onChange={(e) => { setPreviewRecipientId(e.target.value); setPreview(null); }}
                className="py-2 px-2 rounded-xl text-[11px]"
                style={{ background: "var(--bg-input)", color: "var(--text-secondary)", border: "1px solid var(--border)", maxWidth: "140px" }}
              >
                <option value="">First recipient</option>
                {recipients.filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.firstName || r.email}
                  </option>
                ))}
              </select>
            </div>

            {preview && (
              <div className="rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                <p className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                  Subject: {preview.subject}
                </p>
                <pre className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  {preview.body}
                </pre>
              </div>
            )}

            {/* Schedule button */}
            <button
              onClick={handleSchedule}
              disabled={formBusy || !formName.trim() || !formTemplate || !formDateTime}
              className="w-full py-2.5 rounded-full text-[13px] font-medium transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {formBusy ? "Scheduling..." : "Schedule Email"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
