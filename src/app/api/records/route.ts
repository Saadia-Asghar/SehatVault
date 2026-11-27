import { randomUUID } from "crypto";
import { handle, requireUser, HttpError, errorMessage } from "@/lib/server";
import { chain, explorerTx, explorerAddress } from "@/lib/chain";
import { commitment, randomHex32, sha256Hex } from "@/lib/hash";
import { loadRecords } from "@/lib/records";
import type { Extraction } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const isoDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export const GET = handle(async (req) => {
  const ctx = await requireUser(req);
  const records = await loadRecords(ctx);
  return Response.json({
    records: records.map((r) => ({ ...r, explorer: explorerTx(r.tx_hash) })),
    contract: explorerAddress(),
  });
});

export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  const form = await req.formData();
  const file = form.get("file");
  const raw = form.get("data");
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
  if (typeof raw !== "string") throw new HttpError(400, "Missing record data");
  const data = JSON.parse(raw) as Extraction;

  const buf = Buffer.from(await file.arrayBuffer());
  const id = randomUUID();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${ctx.userId}/${id}.${ext}`;

  const up = await ctx.db.storage.from("records").upload(path, buf, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw new HttpError(500, `Upload failed: ${up.error.message}`);

  const fileSha = sha256Hex(buf);
  const salt = randomHex32();
  const c = commitment(fileSha, salt);
  const docDate = isoDate(data.doc_date);

  const ins = await ctx.db.from("medical_records").insert({
    id,
    user_id: ctx.userId,
    doc_type: data.doc_type,
    doc_date: docDate,
    doctor: data.doctor,
    facility: data.facility,
    summary: data.summary,
    extracted: data,
    uncertain_fields: data.uncertain_fields ?? [],
    file_path: path,
    file_mime: file.type,
    file_sha256: fileSha,
    record_salt: salt,
    commitment: c,
  });
  if (ins.error) throw new HttpError(500, ins.error.message);

  const meds = (data.medications ?? []).filter((m) => m.name?.trim());
  if (meds.length) {
    await ctx.db.from("medications").insert(
      meds.map((m) => ({ record_id: id, user_id: ctx.userId, name: m.name, dose: m.dose, frequency: m.frequency, duration: m.duration, uncertain: !!m.uncertain })),
    );
  }
  const labs = (data.lab_results ?? []).filter((l) => l.test_name?.trim());
  if (labs.length) {
    await ctx.db.from("lab_results").insert(
      labs.map((l) => ({ record_id: id, user_id: ctx.userId, test_name: l.test_name, value: l.value, unit: l.unit, ref_range: l.ref_range, result_date: docDate })),
    );
  }

  // Never lose the record if anchoring fails; the Privacy page offers a retry.
  let tx: string | null = null;
  let anchorError: string | null = null;
  try {
    tx = await chain.registerRecord(ctx.patientId, c);
    await ctx.db.from("medical_records").update({ tx_hash: tx }).eq("id", id);
  } catch (e) {
    anchorError = errorMessage(e);
  }
  return Response.json({ id, tx_hash: tx, explorer: explorerTx(tx), anchorError });
});
