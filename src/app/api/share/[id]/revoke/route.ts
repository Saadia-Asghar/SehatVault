import { handle, requireUser, HttpError, errorMessage } from "@/lib/server";
import { chain, explorerTx } from "@/lib/chain";
import type { Hex } from "@/lib/hash";
import { parseId } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Revoking must always work, even if the relayer is out of gas or Avalanche is down. The database is
 * updated first: the doctor view checks it before the contract, so the link closes immediately.
 * The on-chain revoke follows; if it fails, the patient can press Revoke again to retry it.
 */
export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const id = parseId((await params).id);
  const { data: share, error } = await ctx.db
    .from("share_permissions")
    .select("id,share_chain_id,status,revoke_tx_hash")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!share) throw new HttpError(404, "Share not found");
  if (share.status === "revoked" && share.revoke_tx_hash) throw new HttpError(400, "Already revoked");

  if (share.status !== "revoked") {
    const { error: updErr } = await ctx.db.from("share_permissions").update({ status: "revoked" }).eq("id", id);
    if (updErr) throw new HttpError(500, updErr.message);
  }

  let tx: string | null = null;
  let chainPending = false;
  try {
    if (await chain.isShareActive(share.share_chain_id as Hex)) {
      tx = await chain.revokeShare(share.share_chain_id as Hex, ctx.patientId);
      const { error: txErr } = await ctx.db.from("share_permissions").update({ revoke_tx_hash: tx }).eq("id", id);
      if (txErr) console.error("revoked on-chain but tx hash not saved", id, tx, txErr.message);
    }
  } catch (e) {
    // A concurrent revoke may have won; only report pending if the contract still says active.
    console.error("on-chain revoke failed", id, errorMessage(e));
    chainPending = await chain.isShareActive(share.share_chain_id as Hex).catch(() => true);
  }
  return Response.json({ ok: true, explorer: explorerTx(tx), chainPending });
});
