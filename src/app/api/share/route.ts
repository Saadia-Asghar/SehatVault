import QRCode from "qrcode";
import { z } from "zod";
import { handle, requireUser, HttpError } from "@/lib/server";
import { chain, explorerTx } from "@/lib/chain";
import { randomHex32, randomToken, scopeHash, sha256Hex } from "@/lib/hash";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  record_ids: z.array(z.string().uuid()).min(1).max(50),
  duration_hours: z.number().min(0.01).max(168),
  brief: z.string().max(8000).optional().default(""),
});

export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid share request");
  const { record_ids, duration_hours, brief } = parsed.data;

  const { data: owned, error } = await ctx.db.from("medical_records").select("id").eq("user_id", ctx.userId).in("id", record_ids);
  if (error) throw new HttpError(500, error.message);
  if ((owned ?? []).length !== new Set(record_ids).size) throw new HttpError(403, "Some records are not yours");

  const token = randomToken();
  const shareChainId = randomHex32();
  const expiresAtSec = Math.floor(Date.now() / 1000 + duration_hours * 3600);

  // Register the permission on Avalanche first; nothing is stored if this fails.
  const tx = await chain.createShare(shareChainId, ctx.patientId, scopeHash(record_ids), BigInt(expiresAtSec));

  const { data: share, error: insErr } = await ctx.db
    .from("share_permissions")
    .insert({
      user_id: ctx.userId,
      share_chain_id: shareChainId,
      token_hash: sha256Hex(Buffer.from(token)),
      brief,
      expires_at: new Date(expiresAtSec * 1000).toISOString(),
      tx_hash: tx,
    })
    .select("id,expires_at")
    .single();
  if (insErr || !share) throw new HttpError(500, insErr?.message ?? "Could not save share");
  await ctx.db.from("share_records").insert(record_ids.map((record_id) => ({ share_id: share.id, record_id })));

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
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(500, error.message);
  const now = Date.now();
  const shares = (data ?? []).map((s) => ({
    ...s,
    state: s.status === "revoked" ? "revoked" : new Date(s.expires_at).getTime() < now ? "expired" : "active",
    record_count: (s.share_records as unknown[]).length,
    views: (s.access_logs as { result: string }[]).filter((l) => l.result === "granted").length,
    explorer: explorerTx(s.tx_hash),
    revoke_explorer: explorerTx(s.revoke_tx_hash),
  }));
  return Response.json({ shares });
});
