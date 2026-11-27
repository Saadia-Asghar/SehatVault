"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/client";

type Share = {
  id: string;
  expires_at: string;
  created_at: string;
  state: "active" | "expired" | "revoked";
  record_count: number;
  views: number;
  explorer: string | null;
  revoke_explorer: string | null;
};

const STATE_STYLE = {
  active: "bg-teal-50 text-brand",
  expired: "bg-slate-100 text-slate-600",
  revoked: "bg-red-50 text-red-700",
};

export default function SharePage() {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<{ shares: Share[] }>("/api/share")
      .then((d) => setShares(d.shares))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function revoke(id: string) {
    if (!confirm("Revoke this access? The doctor will no longer be able to open the link.")) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/share/${id}/revoke`, { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell title="Shared access">
      <p className="mb-4 text-sm text-slate-600">
        Every share is a time-limited permission registered on Avalanche. New shares are created by{" "}
        <Link href="/agent" className="text-brand underline">Sehat AI</Link>.
      </p>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {shares === null && !error && <p className="text-slate-500">Loading…</p>}
      {shares?.length === 0 && <div className="card text-center text-slate-600">No shares yet.</div>}
      <div className="space-y-3">
        {shares?.map((s) => (
          <div key={s.id} className="card space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{s.record_count} records</span>
              <span className={`badge ${STATE_STYLE[s.state]}`}>{s.state}</span>
            </div>
            <div className="text-sm text-slate-600">
              Created {new Date(s.created_at).toLocaleString()} · expires {new Date(s.expires_at).toLocaleString()}
            </div>
            <div className="text-sm text-slate-600">Opened {s.views} time{s.views === 1 ? "" : "s"}</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {s.explorer && <a className="text-brand underline" href={s.explorer} target="_blank" rel="noreferrer">Permission tx ↗</a>}
              {s.revoke_explorer && <a className="text-brand underline" href={s.revoke_explorer} target="_blank" rel="noreferrer">Revocation tx ↗</a>}
            </div>
            {s.state === "active" && (
              <button className="btn-danger" disabled={busy === s.id} onClick={() => revoke(s.id)}>
                {busy === s.id ? "Revoking on Avalanche…" : "Revoke access"}
              </button>
            )}
          </div>
        ))}
      </div>
    </AppShell>
  );
}
