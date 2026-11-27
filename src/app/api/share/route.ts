import QRCode from "qrcode";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handle, requireUser, HttpError, errorMessage } from "@/lib/server";
import { chain, explorerTx } from "@/lib/chain";
import { randomHex32, randomToken, scopeHash, sha256Hex } from "@/lib/hash";
import { chainWriteLimiter, requireRate } from "@/lib/ratelimit";
import { shareStateFromDb } from "@/lib/shareState";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  record_ids: z.array(z.string().uuid()).min(1).max(50),
  duration_hours: z.number().min(0.01).max(168),
  brief: z.string().max(8000).optional().default(""),
});

async function deleteShare(db: SupabaseClient, id: string) {
  const { error } = await db.from("share_permissions").delete().eq("id", id);
  if (error) console.error("could not clean up share", id, error.message);
}

export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid share request");
  const { brief, duration_hours } = parsed.data;
  const record_ids = [...new Set(parsed.data.record_ids)];

  const { data: owned, error } = await ctx.db.from("medical_records").select("id").eq("user_id", ctx.userId).in("id", record_ids);
  if (error) throw new HttpError(500, error.message);
  if ((owned ?? []).length !== record_ids.length) throw new HttpError(403, "Some records are not yours");
  requireRate(chainWriteLimiter, ctx.userId);

  const token = randomToken();
  const shareChainId = randomHex32();
  const expiresAtSec = Math.floor(Date.now() / 1000 + duration_hours * 3600);

  // 1. Save as "pending": the doctor link does not work until the chain confirms it.
  const { data: share, error: insErr } = await ctx.db
    .from("share_permissions")
    .insert({
      user_id: ctx.userId,
      share_chain_id: shareChainId,
      token_hash: sha256Hex(Buffer.from(token)),
      brief,
      expires_at: new Date(expiresAtSec * 1000).toISOString(),
      status: "pending",
    })
    .select("id,expires_at")
    .single();
  if (insErr || !share) throw new HttpError(500, insErr?.message ?? "Could not save share");

  const { error: recErr } = await ctx.db.from("share_records").insert(record_ids.map((record_id) => ({ share_id: share.id, record_id })));
  if (recErr) {
    await deleteShare(ctx.db, share.id);
    throw new HttpError(500, recErr.message);
  }

  // 2. Register the permission on Avalanche.
  let tx: string;
  try {
    tx = await chain.createShare(shareChainId, ctx.patientId, scopeHash(record_ids), BigInt(expiresAtSec));
  } catch (e) {
    console.error("createShare failed", errorMessage(e));
    await deleteShare(ctx.db, share.id);
    throw new HttpError(502, "Could not register the permission on Avalanche. Please try again.");
  }

  // 3. Activate.
  const { error: actErr } = await ctx.db.from("share_permissions").update({ status: "active", tx_hash: tx }).eq("id", share.id);
  if (actErr) throw new HttpError(500, `share ${share.id} on-chain (${tx}) but not activated: ${actErr.message}`);

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const url = `${origin}/s/${token}`;
  const qr = await QRCode.toDataURL(url, { width: 360, margin: 1 });
  return Response.json({ id: share.id, url, qr, expires_at: share.expires_at, explorer: explorerTx(tx) });
});

export const GET = handle(async (req) => {
  const ctx = await requireUser(req);
  const { data, error } = await ctx.db
    .from("share_permissions")
    .select("id,brief,expires_at,status,tx_hash,revoke_tx_hash,created_at,share_records(record_id),access_logs(result,accessed_at,tx_hash)")
    .eq("user_id", ctx.userId)
    .neq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(500, error.message);
  const shares = (data ?? []).map((s) => ({
    ...s,
    state: shareStateFromDb(s.status, s.expires_at),
    record_count: (s.share_records as unknown[]).length,
    views: (s.access_logs as { result: string }[]).filter((l) => l.result === "granted").length,
    explorer: explorerTx(s.tx_hash),
    revoke_explorer: explorerTx(s.revoke_tx_hash),
  }));
  return Response.json({ shares });
});
