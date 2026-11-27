"use client";
import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import RecordCard from "@/components/RecordCard";
import { api } from "@/lib/client";
import { DOC_LABELS, type RecordRow } from "@/lib/types";

export default function TimelinePage() {
  const [records, setRecords] = useState<RecordRow[] | null>(null);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ records: RecordRow[] }>("/api/records")
      .then((d) => setRecords(d.records))
      .catch((e) => setError(e.message));
  }, []);

  const groups = useMemo(() => {
    const needle = q.toLowerCase();
    const list = (records ?? []).filter(
      (r) => (!type || r.doc_type === type) && (!needle || JSON.stringify(r).toLowerCase().includes(needle)),
    );
    const byYear = new Map<string, RecordRow[]>();
    for (const r of list) {
      const y = r.doc_date?.slice(0, 4) ?? "Undated";
      byYear.set(y, [...(byYear.get(y) ?? []), r]);
    }
    return [...byYear.entries()];
  }, [records, type, q]);

  async function openFile(id: string) {
    try {
      const { url } = await api<{ url: string }>(`/api/records/${id}`);
      window.open(url, "_blank");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <AppShell title="Health timeline">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <input className="input" placeholder="Search doctor, medicine, test…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(DOC_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {records === null && !error && <p className="text-slate-500">Loading…</p>}
      {records && groups.length === 0 && <p className="text-slate-500">No records match.</p>}
      <div className="space-y-6">
        {groups.map(([year, list]) => (
          <section key={year}>
            <h2 className="mb-2 font-display text-lg font-bold text-brand">{year}</h2>
            <div className="space-y-3 border-l-2 border-teal-200 pl-4">
              {list.map((r) => (
                <RecordCard
                  key={r.id}
                  r={r}
                  action={<button className="text-sm text-brand underline" onClick={() => openFile(r.id)}>Open original</button>}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
