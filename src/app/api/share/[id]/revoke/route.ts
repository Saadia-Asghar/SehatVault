import { handle, requireUser, HttpError } from "@/lib/server";
import { chain, explorerTx } from "@/lib/chain";
import type { Hex } from "@/lib/hash";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireUser(req);
  const { id } = await params;
  const { data: share } = await ctx.db
    .from("share_permissions")
    .select("id,share_chain_id,status")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!share) throw new HttpError(404, "Share not found");
  if (share.status === "revoked") throw new HttpError(400, "Already revoked");

  const tx = await chain.revokeShare(share.share_chain_id as Hex, ctx.patientId);
  await ctx.db.from("share_permissions").update({ status: "revoked", revoke_tx_hash: tx }).eq("id", id);
  return Response.json({ ok: true, explorer: explorerTx(tx) });
});
