import { admin, handle, errorMessage } from "@/lib/server";
import { chain, explorerAddress } from "@/lib/chain";
import { sha256Hex, type Hex } from "@/lib/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public doctor view: no login. Access requires the secret token from the QR. */
export const GET = handle<{ params: Promise<{ token: string }> }>(async (_req, { params }) => {
  const { token } = await params;
  const db = admin();
  const { data: share } = await db
    .from("share_permissions")
    .select("id,user_id,share_chain_id,brief,expires_at,status")
    .eq("token_hash", sha256Hex(Buffer.from(token)))
    .maybeSingle();
  if (!share) return Response.json({ state: "invalid" }, { status: 404 });

  let state: "active" | "expired" | "revoked" =
    share.status === "revoked" ? "revoked" : new Date(share.expires_at).getTime() < Date.now() ? "expired" : "active";
  if (state === "active") {
    try {
      if (!(await chain.isShareActive(share.share_chain_id as Hex))) state = "revoked";
    } catch (e) {
      console.error("on-chain check failed", errorMessage(e));
    }
  }
  if (state !== "active") {
    await db.from("access_logs").insert({ share_id: share.id, result: state });
    return Response.json({ state }, { status: 410 });
  }

  const { data: rows } = await db
    .from("share_records")
    .select("medical_records(id,doc_type,doc_date,doctor,facility,summary,file_path,tx_hash,medications(name,dose,frequency,duration),lab_results(test_name,value,unit))")
    .eq("share_id", share.id);

  type Rec = {
    id: string; doc_type: string | null; doc_date: string | null; doctor: string | null; facility: string | null;
    summary: string | null; file_path: string; tx_hash: string | null;
    medications: { name: string; dose: string | null; frequency: string | null; duration: string | null }[];
    lab_results: { test_name: string; value: number | null; unit: string | null }[];
  };
  const recs = ((rows ?? []) as unknown as { medical_records: Rec | null }[])
    .map((r) => r.medical_records)
    .filter((r): r is Rec => !!r)
    .sort((a, b) => (b.doc_date ?? "").localeCompare(a.doc_date ?? ""));

  const records = await Promise.all(
    recs.map(async ({ file_path, ...r }) => {
      const { data } = await db.storage.from("records").createSignedUrl(file_path, 300);
      return { ...r, file_url: data?.signedUrl ?? null, anchored: !!r.tx_hash };
    }),
  );

  const { data: profile } = await db.from("profiles").select("display_name").eq("user_id", share.user_id).maybeSingle();

  let tx: string | null = null;
  try {
    tx = await chain.logAccess(share.share_chain_id as Hex);
  } catch (e) {
    console.error("logAccess failed", errorMessage(e));
  }
  await db.from("access_logs").insert({ share_id: share.id, result: "granted", tx_hash: tx });

  return Response.json({
    state,
    patient: profile?.display_name ?? "Patient",
    brief: share.brief,
    expires_at: share.expires_at,
    records,
    contract: explorerAddress(),
  });
});
