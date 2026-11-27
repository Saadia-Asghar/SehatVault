import { HttpError, type Ctx } from "./server";
import { chain } from "./chain";
import { commitment, sha256Hex, type Hex } from "./hash";

export const RECORD_SELECT =
  "id,doc_type,doc_date,doctor,facility,summary,extracted,uncertain_fields,tx_hash,created_at," +
  "medications(name,dose,frequency,duration,uncertain),lab_results(test_name,value,unit,ref_range)";

export type DbMed = { name: string; dose: string | null; frequency: string | null; duration: string | null; uncertain: boolean };
export type DbLab = { test_name: string; value: number | null; unit: string | null; ref_range: string | null };
export type DbRecord = {
  id: string;
  doc_type: string | null;
  doc_date: string | null;
  doctor: string | null;
  facility: string | null;
  summary: string | null;
  extracted: Record<string, unknown> | null;
  uncertain_fields: string[] | null;
  tx_hash: string | null;
  created_at: string;
  medications: DbMed[];
  lab_results: DbLab[];
};

export async function loadRecords(ctx: Ctx, ids?: string[]): Promise<DbRecord[]> {
  let q = ctx.db.from("medical_records").select(RECORD_SELECT).eq("user_id", ctx.userId);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.order("doc_date", { ascending: false, nullsFirst: false });
  if (error) throw new HttpError(500, error.message);
  return (data ?? []) as unknown as DbRecord[];
}

/** Compact, AI-friendly view of a record. */
export function compact(r: DbRecord) {
  const ex = r.extracted ?? {};
  return {
    id: r.id,
    date: r.doc_date,
    type: r.doc_type,
    doctor: r.doctor,
    facility: r.facility,
    summary: r.summary,
    reason: (ex.complaint_or_reason as string | null) ?? null,
    diagnosis_as_written: (ex.diagnosis_as_written as string | null) ?? null,
    follow_up: (ex.follow_up as string | null) ?? null,
    medications: r.medications.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ")),
    lab_results: r.lab_results.map((l) => `${l.test_name}: ${l.value ?? "?"} ${l.unit ?? ""}`.trim()),
  };
}

/** Re-hashes a file and checks it against the stored and on-chain commitment. */
export async function verifyRecordFile(ctx: Ctx, recordId: string, uploaded?: Buffer) {
  const { data: rec, error } = await ctx.db
    .from("medical_records")
    .select("id,file_path,record_salt,commitment,tx_hash")
    .eq("id", recordId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!rec) throw new HttpError(404, "Record not found");

  let buf = uploaded;
  if (!buf) {
    const { data: blob, error: dlErr } = await ctx.db.storage.from("records").download(rec.file_path);
    if (dlErr || !blob) throw new HttpError(500, "Could not load stored file");
    buf = Buffer.from(await blob.arrayBuffer());
  }
  const recomputed = commitment(sha256Hex(buf), rec.record_salt as Hex);
  const intact = recomputed === rec.commitment;
  let anchoredOnChain: boolean | null = null;
  try {
    anchoredOnChain = await chain.verifyRecord(ctx.patientId, rec.commitment as Hex);
  } catch {
    anchoredOnChain = null;
  }
  return { record_id: rec.id, intact, anchoredOnChain, tx_hash: rec.tx_hash as string | null, checked: uploaded ? "uploaded file" : "stored file" };
}
