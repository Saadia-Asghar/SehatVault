"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import RecordCard from "@/components/RecordCard";
import { api } from "@/lib/client";
import type { RecordRow } from "@/lib/types";

type Share = { id: string; state: string };

export default function Dashboard() {
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ records: RecordRow[] }>("/api/records")
      .then((d) => setRecords(d.records))
      .catch((e) => setError(e.message));
    api<{ shares: Share[] }>("/api/share")
      .then((d) => setShares(d.shares))
      .catch(() => {});
  }, []);

  const active = shares.filter((s) => s.state === "active").length;

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-extrabold">Assalam-o-Alaikum 👋</h1>
      <p className="mb-4 text-slate-600">Your medical history, organised and under your control.</p>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Records" value={records?.length ?? "–"} />
        <Stat label="Verified" value={records?.filter((r) => r.tx_hash).length ?? "–"} />
        <Stat label="Active shares" value={active} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link href="/upload" className="btn-primary text-center">📷 Scan document</Link>
        <Link href="/agent" className="btn-primary text-center">✨ Prepare a visit</Link>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Recent records</h2>
        <Link href="/timeline" className="text-sm text-brand">See all</Link>
      </div>
      <div className="space-y-3">
        {records === null && !error && <p className="text-slate-500">Loading…</p>}
        {records?.length === 0 && (
          <div className="card text-center text-slate-600">
            No records yet. <Link href="/upload" className="text-brand underline">Scan your first prescription</Link>.
          </div>
        )}
        {records?.slice(0, 3).map((r) => <RecordCard key={r.id} r={r} />)}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card text-center">
      <div className="font-display text-2xl font-extrabold text-brand">{value}</div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}
