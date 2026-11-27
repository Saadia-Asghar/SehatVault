import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, handle, errorMessage, HttpError } from "@/lib/server";
import { chain, explorerAddress } from "@/lib/chain";
import { sha256Hex, type Hex } from "@/lib/hash";
import { clientIp, publicViewLimiter } from "@/lib/ratelimit";
import { anchorWindowStart, shareStateFromDb } from "@/lib/shareState";
import { isShareToken } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short, so a document link stops working soon after a revoke or expiry. */
const SIGNED_URL_SECONDS = 60;
const NO_STORE = { "cache-control": "no-store" };

type Rec = {
  id: string; doc_type: string | null; doc_date: string | null; doctor: string | null; facility: string | null;
  summary: string | null; file_path: string; tx_hash: string | null;
  medications: { name: string; dose: string | null; frequency: string | null; duration: string | null }[];
  lab_results: { test_name: string; value: number | null; unit: string | null }[];
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

async function logView(db: SupabaseClient, shareId: string, result: string, txHash: string | null = null) {
  const { error } = await db.from("access_logs").insert({ share_id: shareId, result, tx_hash: txHash });
  if (error) console.error("access log insert failed", error.message);
}

/**
 * Sends a paid on-chain access event at most once per share per window. The slot is claimed with a
 * single conditional UPDATE, so concurrent views cannot both win, and a failed send still uses the slot.
 */
async function anchorAccess(db: SupabaseClient, shareId: string, shareChainId: Hex): Promise<string | null> {
  const { data: claimed, error } = await db
    .from("share_permissions")
    .update({ last_anchor_at: new Date().toISOString() })
    .eq("id", shareId)
    .or(`last_anchor_at.is.null,last_anchor_at.lt.${anchorWindowStart()}`)
    .select("id");
  if (error) {
    console.error("anchor slot claim failed", error.message);
    return null; // fail safe: skip the paid transaction
  }
  if (!claimed?.length) return null;
  try {
    return await chain.logAccess(shareChainId);
  } catch (e) {
    console.error("logAccess failed", errorMessage(e));
    return null;
  }
}

async function loadSharedRecords(db: SupabaseClient, shareId: string) {
  const { data: rows, error } = await db
    .from("share_records")
    .select("medical_records(id,doc_type,doc_date,doctor,facility,summary,file_path,tx_hash,medications(name,dose,frequency,duration),lab_results(test_name,value,unit))")
    .eq("share_id", shareId);
  if (error) throw new HttpError(500, error.message);
  const recs = ((rows ?? []) as unknown as { medical_records: Rec | null }[])
    .map((r) => r.medical_records)
    .filter((r): r is Rec => !!r)
    .sort((a, b) => (b.doc_date ?? "").localeCompare(a.doc_date ?? ""));
  return Promise.all(
    recs.map(async ({ file_path, ...r }) => {
      const { data } = await db.storage.from("records").createSignedUrl(file_path, SIGNED_URL_SECONDS);
      return { ...r, file_url: data?.signedUrl ?? null, anchored: !!r.tx_hash };
    }),
  );
}

/** Public doctor view: no login. Access requires the secret token from the QR. */
export const GET = handle<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  if (!publicViewLimiter.check(clientIp(req))) return json({ state: "rate_limited" }, 429);
  const { token } = await params;
  if (!isShareToken(token)) return json({ state: "invalid" }, 404);

  const db = admin();
  const { data: share, error } = await db
    .from("share_permissions")
    .select("id,user_id,share_chain_id,brief,expires_at,status")
    .eq("token_hash", sha256Hex(Buffer.from(token)))
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!share) return json({ state: "invalid" }, 404);

  const dbState = shareStateFromDb(share.status, share.expires_at);
  if (dbState === "invalid") return json({ state: "invalid" }, 404);
  if (dbState !== "active") {
    await logView(db, share.id, dbState);
    return json({ state: dbState }, 410);
  }

  // The contract is the independent source of truth: if it can't be checked, don't show records.
  let activeOnChain: boolean;
  try {
    activeOnChain = await chain.isShareActive(share.share_chain_id as Hex);
  } catch (e) {
    console.error("on-chain check failed", errorMessage(e));
    return json({ state: "unavailable" }, 503);
  }
  if (!activeOnChain) {
    await logView(db, share.id, "revoked");
    return json({ state: "revoked" }, 410);
  }

  const records = await loadSharedRecords(db, share.id);
  const { data: profile } = await db.from("profiles").select("display_name").eq("user_id", share.user_id).maybeSingle();
  const tx = await anchorAccess(db, share.id, share.share_chain_id as Hex);
  await logView(db, share.id, "granted", tx);

  return json({
    state: "active",
    patient: profile?.display_name ?? "Patient",
    brief: share.brief,
    expires_at: share.expires_at,
    records,
    contract: explorerAddress(),
  });
});
