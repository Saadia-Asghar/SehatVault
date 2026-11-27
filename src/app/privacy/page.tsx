"use client";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/client";
import { docLabel, formatDate, type RecordRow } from "@/lib/types";

type VerifyResult = { intact: boolean; anchoredOnChain: boolean | null; checked: string };

export default function PrivacyPage() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [contract, setContract] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, VerifyResult | string>>({});
  const [fileRecord, setFileRecord] = useState("");
  const [fileResult, setFileResult] = useState<VerifyResult | string | null>(null);

  const load = useCallback(
    () =>
      api<{ records: RecordRow[]; contract: string | null }>("/api/records").then((d) => {
        setRecords(d.records);
        setContract(d.contract);
      }),
    [],
  );
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function verify(id: string) {
    setResults((r) => ({ ...r, [id]: "Checking…" }));
    try {
      const res = await api<VerifyResult>("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ record_id: id }),
      });
      setResults((r) => ({ ...r, [id]: res }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: (e as Error).message }));
    }
  }

  async function retry(id: string) {
    setResults((r) => ({ ...r, [id]: "Anchoring…" }));
    try {
      const res = await api<{ alreadyAnchored?: boolean }>(`/api/records/${id}`, { method: "POST" });
      await load();
      setResults((r) => ({ ...r, [id]: res.alreadyAnchored ? "Already on Avalanche ✓" : "Anchored ✓" }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: (e as Error).message }));
    }
  }

  async function verifyFile(file: File | undefined) {
    if (!file || !fileRecord) return;
    setFileResult("Checking…");
    const fd = new FormData();
    fd.append("record_id", fileRecord);
    fd.append("file", file);
    try {
      setFileResult(await api<VerifyResult>("/api/verify", { method: "POST", body: fd }));
    } catch (e) {
      setFileResult((e as Error).message);
    }
  }

  return (
    <AppShell title="Privacy & proof">
      <div className="card mb-4 space-y-2 text-sm">
        <p className="font-semibold">What is stored on Avalanche?</p>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>A salted fingerprint (hash) of each document — proves it was not changed.</li>
          <li>Share permissions: random id, expiry time, revoked or not.</li>
          <li>Access events: a timestamp each time a shared link is opened.</li>
        </ul>
        <p className="text-slate-700">
          <b>Never on-chain:</b> your name, documents, medicines, diagnoses or links. Files stay in private storage.
        </p>
        {contract && <a href={contract} target="_blank" rel="noreferrer" className="text-brand underline">View SehatVault contract on Fuji ↗</a>}
      </div>

      <div className="card mb-4 space-y-2">
        <p className="font-semibold">Check a copy of a document</p>
        <p className="text-sm text-slate-600">Upload a file someone gave you to see if it matches your registered original.</p>
        <select className="input" value={fileRecord} onChange={(e) => setFileRecord(e.target.value)}>
          <option value="">Select the original record…</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>{docLabel(r.doc_type)} · {formatDate(r.doc_date)} {r.doctor ? `· ${r.doctor}` : ""}</option>
          ))}
        </select>
        <input type="file" disabled={!fileRecord} onChange={(e) => verifyFile(e.target.files?.[0])} className="text-sm" />
        {fileResult && <Result r={fileResult} />}
      </div>

      <div className="space-y-2">
        {records.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <div className="font-semibold">{docLabel(r.doc_type)} · {formatDate(r.doc_date)}</div>
              {r.explorer ? (
                <a href={r.explorer} target="_blank" rel="noreferrer" className="text-brand underline">Registration tx ↗</a>
              ) : (
                <button onClick={() => retry(r.id)} className="text-amber-700 underline">Not anchored — retry</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {results[r.id] && <Result r={results[r.id]} />}
              <button className="btn-secondary px-3 py-1 text-sm" onClick={() => verify(r.id)}>Verify</button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function Result({ r }: { r: VerifyResult | string }) {
  if (typeof r === "string") return <span className="text-slate-600">{r}</span>;
  return r.intact ? (
    <span className="badge bg-teal-50 text-brand">
      ✓ Intact{r.anchoredOnChain ? " · matches Avalanche" : r.anchoredOnChain === false ? " · not on-chain" : ""}
    </span>
  ) : (
    <span className="badge bg-red-50 text-red-700">✕ Modified — does not match the registered version</span>
  );
}
