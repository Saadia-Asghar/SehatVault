"use client";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/client";
import { docLabel, formatDate } from "@/lib/types";
import type { AgentResult, Approval, ChatTurn, Step } from "@/lib/agent";

const STEP_LABELS: Record<string, string> = {
  search_records: "Searching your medical history",
  get_record: "Reading a record",
  list_medications: "Listing recorded medicines",
  compare_lab_results: "Comparing lab results",
  generate_visit_brief: "Writing consultation brief",
  request_approval: "Waiting for your approval",
  verify_document: "Verifying document integrity",
};

const SUGGESTIONS = [
  "I'm seeing a cardiologist tomorrow. Prepare my history and share it for 24 hours.",
  "When was my last blood test?",
  "Which medicines have I been prescribed?",
  "Compare my HbA1c results.",
];

type Msg = { role: "user" | "model"; text: string; steps?: Step[]; approval?: Approval };
type ShareResult = { url: string; qr: string; expires_at: string; explorer: string | null };

export default function AgentPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const res = await api<AgentResult>("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      setMsgs((m) => [...m, { role: "model", text: res.answer, steps: res.steps, approval: res.approval }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Sehat AI">
      <p className="mb-4 text-sm text-slate-600">
        Answers come only from your uploaded records. Sehat AI does not diagnose or prescribe.
      </p>

      {msgs.length === 0 && (
        <div className="mb-4 space-y-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} className="card w-full text-left text-sm hover:border-brand">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-white">{m.text}</div>
          ) : (
            <div key={i} className="space-y-3">
              {m.steps && m.steps.length > 0 && <AgentTrace steps={m.steps} />}
              {m.text && <div className="card whitespace-pre-wrap text-sm">{m.text}</div>}
              {m.approval && <ApprovalCard approval={m.approval} />}
            </div>
          ),
        )}
        {busy && <div className="card animate-pulse text-sm text-slate-600">✨ Sehat AI is working on it…</div>}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="fixed inset-x-0 bottom-16 z-10 mx-auto flex max-w-2xl gap-2 bg-brand-bg px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input className="input" placeholder="Ask about your records…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn-primary py-2" disabled={busy}>Send</button>
      </form>
      <div className="h-16" />
    </AppShell>
  );
}

function AgentTrace({ steps }: { steps: Step[] }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= steps.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 450);
    return () => clearTimeout(t);
  }, [shown, steps.length]);
  return (
    <div className="card space-y-1 border-dashed text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agent actions</div>
      {steps.slice(0, shown).map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={s.ok ? "text-brand" : "text-red-600"}>{s.ok ? "✓" : "✕"}</span>
          <span className="font-medium">{STEP_LABELS[s.name] ?? s.name}</span>
          <span className="text-slate-500">— {s.summary}</span>
        </div>
      ))}
      {shown < steps.length && <div className="animate-pulse text-slate-400">…</div>}
    </div>
  );
}

function ApprovalCard({ approval }: { approval: Approval }) {
  const [selected, setSelected] = useState<string[]>(approval.record_ids);
  const [hours, setHours] = useState(approval.duration_hours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ShareResult | null>(null);

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const res = await api<ShareResult>("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ record_ids: selected, duration_hours: hours, brief: approval.brief }),
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="card space-y-3 text-center">
        <p className="font-display text-lg font-bold">Show this QR to your doctor</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.qr} alt="Share QR code" className="mx-auto w-60" />
        <p className="text-sm text-slate-600">
          Expires {new Date(result.expires_at).toLocaleString()}. Revoke anytime from the Share tab.
        </p>
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(result.url)}>Copy link</button>
          {result.explorer && (
            <a className="btn-secondary" href={result.explorer} target="_blank" rel="noreferrer">Permission on Avalanche ↗</a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-3 ring-2 ring-brand">
      <p className="font-display font-bold">Approve sharing</p>
      {approval.brief && (
        <details open className="rounded-lg bg-teal-50 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Consultation brief</summary>
          <p className="mt-2 whitespace-pre-wrap">{approval.brief}</p>
        </details>
      )}
      <div className="space-y-1">
        {approval.records.map((r) => (
          <label key={r.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(r.id)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
            />
            <span>
              <b>{docLabel(r.type)}</b> · {formatDate(r.date)} {r.doctor ? `· ${r.doctor}` : ""}
              {r.summary && <span className="block text-slate-500">{r.summary}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        {[1, 24, 168].map((h) => (
          <button
            key={h}
            onClick={() => setHours(h)}
            className={`flex-1 rounded-lg border px-2 py-1 text-sm ${hours === h ? "border-brand bg-teal-50 font-semibold text-brand" : "border-slate-200"}`}
          >
            {h === 1 ? "1 hour" : h === 24 ? "24 hours" : "7 days"}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Anyone with the QR link can view these records until it expires or you revoke it.</p>
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy || selected.length === 0} onClick={approve}>
        {busy ? "Registering permission on Avalanche…" : `Approve & create QR (${selected.length} records)`}
      </button>
    </div>
  );
}
