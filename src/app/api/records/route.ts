import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handle, requireUser, HttpError, errorMessage } from "@/lib/server";
import { chain, explorerTx, explorerAddress } from "@/lib/chain";
import { commitment, randomHex32, sha256Hex } from "@/lib/hash";
import { loadRecords } from "@/lib/records";
import { chainWriteLimiter, requireRate } from "@/lib/ratelimit";
import { checkUpload, parseExtraction } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANCHOR_FAILED = "Avalanche network unavailable";

export const GET = handle(async (req) => {
  const ctx = await requireUser(req);
  const records = await loadRecords(ctx);
  return Response.json({
    records: records.map((r) => ({ ...r, explorer: explorerTx(r.tx_hash) })),
    contract: explorerAddress(),
  });
});

/** Removes a half-saved record (rows cascade) and its file. */
async function rollback(db: SupabaseClient, id: string, path: string) {
  const { error } = await db.from("medical_records").delete().eq("id", id);
  if (error) console.error("rollback: record delete failed", id, error.message);
  const { error: rmErr } = await db.storage.from("records").remove([path]);
  if (rmErr) console.error("rollback: file delete failed", path, rmErr.message);
}

export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  const form = await req.formData();
  const { file, ext, mime } = checkUpload(form.get("file"));
  const data = parseExtraction(form.get("data"));
  requireRate(chainWriteLimiter, ctx.userId);

  const buf = Buffer.from(await file.arrayBuffer());
  const id = randomUUID();
  const path = `${ctx.userId}/${id}.${ext}`;

  const up = await ctx.db.storage.from("records").upload(path, buf, { contentType: mime, upsert: false });
  if (up.error) throw new HttpError(500, `Upload failed: ${up.error.message}`);

  const fileSha = sha256Hex(buf);
  const salt = randomHex32();
  const c = commitment(fileSha, salt);

  const ins = await ctx.db.from("medical_records").insert({
    id,
    user_id: ctx.userId,
    doc_type: data.doc_type,
    doc_date: data.doc_date,
    doctor: data.doctor,
    facility: data.facility,
    summary: data.summary,
    extracted: data,
    uncertain_fields: data.uncertain_fields,
    file_path: path,
    file_mime: mime,
    file_sha256: fileSha,
    record_salt: salt,
    commitment: c,
  });
  if (ins.error) {
    await rollback(ctx.db, id, path);
    throw new HttpError(500, ins.error.message);
  }

  const meds = data.medications.filter((m) => m.name);
  const labs = data.lab_results.filter((l) => l.test_name);
  const [medRes, labRes] = await Promise.all([
    meds.length
      ? ctx.db.from("medications").insert(meds.map((m) => ({ record_id: id, user_id: ctx.userId, ...m })))
      : Promise.resolve({ error: null }),
    labs.length
      ? ctx.db.from("lab_results").insert(labs.map((l) => ({ record_id: id, user_id: ctx.userId, ...l, result_date: data.doc_date })))
      : Promise.resolve({ error: null }),
  ]);
  const childErr = medRes.error ?? labRes.error;
  if (childErr) {
    await rollback(ctx.db, id, path);
    throw new HttpError(500, childErr.message);
  }

  // Never lose the record if anchoring fails; the Privacy page offers a retry.
  let tx: string | null = null;
  let anchorError: string | null = null;
  try {
    tx = await chain.registerRecord(ctx.patientId, c);
    const { error: txErr } = await ctx.db.from("medical_records").update({ tx_hash: tx }).eq("id", id);
    if (txErr) console.error("anchored but tx_hash not saved", id, tx, txErr.message);
  } catch (e) {
    console.error("registerRecord failed", errorMessage(e));
    anchorError = ANCHOR_FAILED;
  }
  return Response.json({ id, tx_hash: tx, explorer: explorerTx(tx), anchorError });
});
