"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { docLabel, formatDate } from "@/lib/types";

type Rec = {
  id: string;
  doc_type: string | null;
  doc_date: string | null;
  doctor: string | null;
  facility: string | null;
  summary: string | null;
  file_url: string | null;
  anchored: boolean;
  medications: { name: string; dose: string | null; frequency: string | null; duration: string | null }[];
  lab_results: { test_name: string; value: number | null; unit: string | null }[];
};
type View =
  | { state: "active"; patient: string; brief: string | null; expires_at: string; records: Rec[]; contract: string | null }
  | { state: "invalid" | "expired" | "revoked" | "error" | "rate_limited" | "unavailable" };

const MESSAGES: Record<string, string> = {
  invalid: "This link is not valid.",
  expired: "This access has expired.",
  revoked: "The patient has revoked this access.",
  error: "Could not load records. Please try again.",
  rate_limited: "Too many requests. Please wait a minute and refresh.",
  unavailable: "Could not confirm this permission on Avalanche right now. Please refresh in a moment.",
};

const RETRYABLE = new Set(["error", "rate_limited", "unavailable"]);

function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h left`;
  if (h >= 1) return `${h}h ${mins % 60}m left`;
  return `${Math.max(1, mins)}m left`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function DoctorView() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View | null>(null);
  const [attempt, setAttempt] = useState(0);
  const now = useNow(30_000);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/s/${token}`, { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setView(d.state ? d : { state: "error" }))
      .catch((e) => {
        if (e.name !== "AbortError") setView({ state: "error" });
      });
    return () => controller.abort();
  }, [token, attempt]);

  const retry = () => {
    setView(null);
    setAttempt((n) => n + 1);
  };

  if (!view) return <div className="grid min-h-dvh place-items-center text-slate-500">Loading shared records…</div>;

  if (view.state !== "active") {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
        <div className="card space-y-2">
          <div className="text-5xl">🔒</div>
          <p className="font-display text-xl font-bold">{MESSAGES[view.state]}</p>
          {RETRYABLE.has(view.state) ? (
            <button className="btn-secondary" onClick={retry}>Try again</button>
          ) : (
            <p className="text-sm text-slate-600">Ask the patient to share a new QR code from SehatVault.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <span className="font-display text-xl font-extrabold">Sehat<span className="text-brand">Vault</span></span>
        <p className="text-sm text-slate-600">
          Shared by <b>{view.patient}</b> · read-only ·{" "}
          <span className="font-semibold text-brand" title={new Date(view.expires_at).toLocaleString()}>
            {timeLeft(view.expires_at, now)}
          </span>
        </p>
      </header>

      {view.brief && (
        <section className="card">
          <h2 className="mb-2 font-display text-lg font-bold">Consultation brief</h2>
          <p className="whitespace-pre-wrap text-sm">{view.brief}</p>
          <p className="mt-2 text-xs text-slate-500">Prepared by AI from the patient&apos;s own records. Check against the original documents below.</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Shared records ({view.records.length})</h2>
        {view.records.map((r) => (
          <div key={r.id} className="card space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase text-brand">{docLabel(r.doc_type)}</div>
                <div className="font-semibold">{formatDate(r.doc_date)}</div>
                <div className="text-sm text-slate-600">{[r.doctor, r.facility].filter(Boolean).join(" · ")}</div>
              </div>
              {r.anchored && <span className="badge bg-teal-50 text-brand">✓ Integrity anchored</span>}
            </div>
            {r.summary && <p className="text-sm">{r.summary}</p>}
            {r.medications.length > 0 && (
              <ul className="list-disc pl-5 text-sm">
                {r.medications.map((m, i) => (
                  <li key={i}>{[m.name, m.dose, m.frequency, m.duration].filter(Boolean).join(" · ")}</li>
                ))}
              </ul>
            )}
            {r.lab_results.length > 0 && (
              <ul className="list-disc pl-5 text-sm">
                {r.lab_results.map((l, i) => (
                  <li key={i}>{l.test_name}: {l.value ?? "?"} {l.unit ?? ""}</li>
                ))}
              </ul>
            )}
            {r.file_url && <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">Open original document ↗</a>}
          </div>
        ))}
      </section>

      <footer className="space-y-1 pb-8 text-xs text-slate-500">
        <p>Not medical advice. Information comes from documents uploaded by the patient.</p>
        <p>
          This visit was recorded as an access event on Avalanche.{" "}
          {view.contract && <a className="underline" href={view.contract} target="_blank" rel="noreferrer">Contract ↗</a>}
        </p>
      </footer>
    </div>
  );
}
