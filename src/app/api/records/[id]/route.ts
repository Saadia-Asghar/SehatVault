import { handle, requireUser, HttpError } from "@/lib/server";
import { chain, explorerTx } from "@/lib/chain";
import type { Hex } from "@/lib/hash";

export const runtime = "nodejs";

type P = { params: Promise<{ id: string }> };

/** Returns a short-lived link to the owner's original document. */
export const GET = handle<P>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const { id } = await params;
  const { data: rec } = await ctx.db.from("medical_records").select("file_path").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!rec) throw new HttpError(404, "Record not found");
  const { data, error } = await ctx.db.storage.from("records").createSignedUrl(rec.file_path, 120);
  if (error || !data) throw new HttpError(500, "Could not create link");
  return Response.json({ url: data.signedUrl });
});

/** Retries anchoring a record on Avalanche. */
export const POST = handle<P>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const { id } = await params;
  const { data: rec } = await ctx.db.from("medical_records").select("commitment,tx_hash").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!rec) throw new HttpError(404, "Record not found");
  if (rec.tx_hash) return Response.json({ tx_hash: rec.tx_hash, explorer: explorerTx(rec.tx_hash) });
  const tx = await chain.registerRecord(ctx.patientId, rec.commitment as Hex);
  await ctx.db.from("medical_records").update({ tx_hash: tx }).eq("id", id);
  return Response.json({ tx_hash: tx, explorer: explorerTx(tx) });
});
