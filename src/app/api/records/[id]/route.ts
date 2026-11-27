import { handle, requireUser, HttpError } from "@/lib/server";
import { chain, explorerTx } from "@/lib/chain";
import type { Hex } from "@/lib/hash";
import { chainWriteLimiter, requireRate } from "@/lib/ratelimit";
import { parseId } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

type P = { params: Promise<{ id: string }> };

/** Returns a short-lived link to the owner's original document. */
export const GET = handle<P>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const id = parseId((await params).id);
  const { data: rec, error } = await ctx.db.from("medical_records").select("file_path").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!rec) throw new HttpError(404, "Record not found");
  const { data, error: urlErr } = await ctx.db.storage.from("records").createSignedUrl(rec.file_path, 120);
  if (urlErr || !data) throw new HttpError(500, urlErr?.message ?? "Could not create link");
  return Response.json({ url: data.signedUrl });
});

/** Retries anchoring a record on Avalanche. */
export const POST = handle<P>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const id = parseId((await params).id);
  const { data: rec, error } = await ctx.db.from("medical_records").select("commitment,tx_hash").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!rec) throw new HttpError(404, "Record not found");
  if (rec.tx_hash) return Response.json({ tx_hash: rec.tx_hash, explorer: explorerTx(rec.tx_hash) });
  // An earlier attempt may have reached the chain without the hash being saved; the contract rejects duplicates.
  if (await chain.verifyRecord(ctx.patientId, rec.commitment as Hex)) {
    return Response.json({ tx_hash: null, explorer: null, alreadyAnchored: true });
  }
  requireRate(chainWriteLimiter, ctx.userId);
  const tx = await chain.registerRecord(ctx.patientId, rec.commitment as Hex);
  const { error: updErr } = await ctx.db.from("medical_records").update({ tx_hash: tx }).eq("id", id);
  if (updErr) throw new HttpError(500, `anchored (${tx}) but tx_hash not saved: ${updErr.message}`);
  return Response.json({ tx_hash: tx, explorer: explorerTx(tx) });
});
