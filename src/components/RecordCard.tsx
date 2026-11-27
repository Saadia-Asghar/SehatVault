"use client";
import { docLabel, formatDate, type RecordRow } from "@/lib/types";

export default function RecordCard({ r, action }: { r: RecordRow; action?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand">{docLabel(r.doc_type)}</div>
          <div className="font-semibold text-brand-ink">{formatDate(r.doc_date)}</div>
          <div className="text-sm text-slate-600">{[r.doctor, r.facility].filter(Boolean).join(" · ") || "Doctor not recorded"}</div>
        </div>
        {r.tx_hash ? (
          <span className="badge bg-teal-50 text-brand" title="Integrity anchored on Avalanche">✓ Verified</span>
        ) : (
          <span className="badge bg-amber-50 text-amber-700">Not anchored</span>
        )}
      </div>
      {r.summary && <p className="mt-2 text-sm text-slate-700">{r.summary}</p>}
      {(r.medications.length > 0 || r.lab_results.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.medications.map((m, i) => (
            <span key={`m${i}`} className="badge bg-sky-50 text-sky-800">💊 {[m.name, m.dose].filter(Boolean).join(" ")}</span>
          ))}
          {r.lab_results.map((l, i) => (
            <span key={`l${i}`} className="badge bg-violet-50 text-violet-800">🧪 {l.test_name} {l.value ?? ""} {l.unit ?? ""}</span>
          ))}
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
