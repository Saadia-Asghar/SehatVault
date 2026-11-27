"use client";
import Link from "next/link";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import { api } from "@/lib/client";
import { shrinkImage } from "@/lib/image";
import type { Extraction, Medication, LabResult } from "@/lib/gemini";

type Phase = "pick" | "reading" | "review" | "saving" | "done";

export default function UploadPage() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [data, setData] = useState<Extraction | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ explorer: string | null; anchorError: string | null } | null>(null);

  async function onPick(picked: File | undefined) {
    if (!picked) return;
    const f = await shrinkImage(picked);
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setError("");
    setPhase("reading");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await api<{ extraction: Extraction }>("/api/extract", { method: "POST", body: fd });
      setData(res.extraction);
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
      setPhase("pick");
    }
  }

  async function save() {
    if (!file || !data) return;
    setPhase("saving");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("data", JSON.stringify(data));
      const res = await api<{ explorer: string | null; anchorError: string | null }>("/api/records", { method: "POST", body: fd });
      setSaved(res);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  }

  function reset() {
    setPhase("pick");
    setData(null);
    setFile(null);
    setPreview(null);
    setSaved(null);
  }

  const unsure = (field: string) => data?.uncertain_fields.includes(field);
  const set = <K extends keyof Extraction>(k: K, v: Extraction[K]) => setData((d) => (d ? { ...d, [k]: v } : d));
  const setMed = (i: number, patch: Partial<Medication>) =>
    setData((d) => (d ? { ...d, medications: d.medications.map((m, j) => (j === i ? { ...m, ...patch } : m)) } : d));
  const setLab = (i: number, patch: Partial<LabResult>) =>
    setData((d) => (d ? { ...d, lab_results: d.lab_results.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : d));

  return (
    <AppShell title="Scan a document">
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {phase === "pick" && (
        <label className="card flex cursor-pointer flex-col items-center gap-3 py-10 text-center">
          <span className="text-5xl">📷</span>
          <span className="font-semibold">Take a photo or upload a prescription, report or PDF</span>
          <span className="text-sm text-slate-500">Old handwritten prescriptions work too.</span>
          <span className="btn-primary">Choose file</span>
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
        </label>
      )}

      {phase === "reading" && (
        <div className="card py-10 text-center">
          <div className="mb-2 animate-pulse text-4xl">✨</div>
          <p className="font-semibold">Reading your document…</p>
          <p className="text-sm text-slate-500">Extracting doctor, date, medicines and tests.</p>
        </div>
      )}

      {(phase === "review" || phase === "saving") && data && (
        <div className="space-y-4">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Uploaded document" className="max-h-72 w-full rounded-2xl bg-white object-contain" />
          )}
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            Please check every field. Fields highlighted in amber were hard to read — correct them before saving.
          </div>

          <div className="card grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={data.doc_type} onChange={(e) => set("doc_type", e.target.value as Extraction["doc_type"])}>
                <option value="prescription">Prescription</option>
                <option value="lab_report">Lab report</option>
                <option value="discharge">Discharge summary</option>
                <option value="consultation">Consultation</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Date" warn={unsure("doc_date")}>
              <input type="date" className="input" value={data.doc_date ?? ""} onChange={(e) => set("doc_date", e.target.value || null)} />
            </Field>
            <Field label="Doctor" warn={unsure("doctor")}>
              <input className="input" value={data.doctor ?? ""} onChange={(e) => set("doctor", e.target.value || null)} />
            </Field>
            <Field label="Hospital / clinic" warn={unsure("facility")}>
              <input className="input" value={data.facility ?? ""} onChange={(e) => set("facility", e.target.value || null)} />
            </Field>
            <Field label="Reason / complaint" warn={unsure("complaint_or_reason")} wide>
              <input className="input" value={data.complaint_or_reason ?? ""} onChange={(e) => set("complaint_or_reason", e.target.value || null)} />
            </Field>
            <Field label="Diagnosis (as written)" warn={unsure("diagnosis_as_written")} wide>
              <input className="input" value={data.diagnosis_as_written ?? ""} onChange={(e) => set("diagnosis_as_written", e.target.value || null)} />
            </Field>
            <Field label="Summary" wide>
              <textarea className="input" rows={2} value={data.summary} onChange={(e) => set("summary", e.target.value)} />
            </Field>
            <Field label="Follow-up" warn={unsure("follow_up")} wide>
              <input className="input" value={data.follow_up ?? ""} onChange={(e) => set("follow_up", e.target.value || null)} />
            </Field>
          </div>

          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">💊 Medicines</h3>
              <button
                className="text-sm text-brand"
                onClick={() => set("medications", [...data.medications, { name: "", dose: null, frequency: null, duration: null, uncertain: false }])}
              >
                + Add
              </button>
            </div>
            {data.medications.length === 0 && <p className="text-sm text-slate-500">None found.</p>}
            {data.medications.map((m, i) => (
              <div key={i} className={`grid grid-cols-2 gap-2 rounded-lg p-2 ${m.uncertain ? "bg-amber-50 ring-1 ring-amber-300" : "bg-slate-50"}`}>
                <input className="input" placeholder="Name" value={m.name} onChange={(e) => setMed(i, { name: e.target.value, uncertain: false })} />
                <input className="input" placeholder="Dose" value={m.dose ?? ""} onChange={(e) => setMed(i, { dose: e.target.value || null })} />
                <input className="input" placeholder="How often" value={m.frequency ?? ""} onChange={(e) => setMed(i, { frequency: e.target.value || null })} />
                <div className="flex gap-2">
                  <input className="input" placeholder="Duration" value={m.duration ?? ""} onChange={(e) => setMed(i, { duration: e.target.value || null })} />
                  <button className="text-red-600" onClick={() => set("medications", data.medications.filter((_, j) => j !== i))}>✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="card space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">🧪 Test results</h3>
              <button
                className="text-sm text-brand"
                onClick={() => set("lab_results", [...data.lab_results, { test_name: "", value: null, unit: null, ref_range: null }])}
              >
                + Add
              </button>
            </div>
            {data.lab_results.length === 0 && <p className="text-sm text-slate-500">None found.</p>}
            {data.lab_results.map((l, i) => (
              <div key={i} className="grid grid-cols-4 gap-2">
                <input className="input col-span-2" placeholder="Test" value={l.test_name} onChange={(e) => setLab(i, { test_name: e.target.value })} />
                <input
                  className="input"
                  placeholder="Value"
                  inputMode="decimal"
                  value={l.value ?? ""}
                  onChange={(e) => setLab(i, { value: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <input className="input" placeholder="Unit" value={l.unit ?? ""} onChange={(e) => setLab(i, { unit: e.target.value || null })} />
              </div>
            ))}
          </div>

          <button className="btn-primary w-full" disabled={phase === "saving"} onClick={save}>
            {phase === "saving" ? "Saving and anchoring on Avalanche…" : "Confirm and save"}
          </button>
        </div>
      )}

      {phase === "done" && saved && (
        <div className="card space-y-3 text-center">
          <div className="text-5xl">✅</div>
          <p className="font-display text-xl font-bold">Saved to your timeline</p>
          {saved.explorer ? (
            <p className="text-sm text-slate-600">
              Integrity anchored on Avalanche.{" "}
              <a href={saved.explorer} target="_blank" rel="noreferrer" className="text-brand underline">View proof</a>
            </p>
          ) : (
            <p className="text-sm text-amber-700">Saved, but anchoring failed ({saved.anchorError}). You can retry from the Privacy page.</p>
          )}
          <div className="flex justify-center gap-2">
            <button className="btn-secondary" onClick={reset}>Scan another</button>
            <Link href="/timeline" className="btn-primary">Open timeline</Link>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, warn, wide, children }: { label: string; warn?: boolean; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`${wide ? "col-span-2" : ""} ${warn ? "rounded-lg bg-amber-50 p-1 ring-1 ring-amber-300" : ""}`}>
      <span className="label">
        {label} {warn && <span className="text-amber-700">· check this</span>}
      </span>
      {children}
    </div>
  );
}
