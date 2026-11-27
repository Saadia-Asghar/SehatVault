/**
 * Loads the fictional demo history into one SehatVault account.
 *
 *   npm run seed -- --email demo@example.com            # adds 14 records, anchors each on Fuji
 *   npm run seed -- --email demo@example.com --reset    # first deletes that account's records, files and shares
 *   npm run seed -- --email demo@example.com --no-anchor
 *
 * The account must have signed in with Google once. Needs .env.local with the Supabase keys and ID_SALT
 * (plus RELAYER_PRIVATE_KEY and CONTRACT_ADDRESS unless --no-anchor).
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { commitment, patientChainId, randomHex32, sha256Hex, type Hex } from "../src/lib/hash";
import { chain } from "../src/lib/chain";
import { DEMO_RECORDS, renderDocumentSvg, type DemoRecord } from "./demo-data";

const BUCKET = "records";
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

type Args = { email: string; reset: boolean; anchor: boolean };

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf("--email");
  const email = i >= 0 ? argv[i + 1]?.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) throw new Error("Usage: npm run seed -- --email <account email> [--reset] [--no-anchor]");
  return { email, reset: argv.includes("--reset"), anchor: !argv.includes("--no-anchor") };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env.local`);
  return v;
}

async function findUser(db: SupabaseClient, email: string) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < PAGE_SIZE) break;
  }
  throw new Error(`No account for ${email}. Sign in to the app with Google once using that account, then rerun.`);
}

/** --reset permanently deletes data, so the email must be typed back (Supabase project shown for context). */
async function confirmReset(email: string, count: number) {
  const project = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).host;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `--reset permanently deletes ${count} records, their files and all shares of ${email} in ${project}.\nType the email to continue: `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== email) throw new Error("Reset cancelled.");
}

async function resetAccount(db: SupabaseClient, userId: string) {
  const { data: files, error: listErr } = await db.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (listErr) throw new Error(`Could not list files: ${listErr.message}`);
  if (files?.length) {
    const { error } = await db.storage.from(BUCKET).remove(files.map((f) => `${userId}/${f.name}`));
    if (error) throw new Error(`Could not delete files: ${error.message}`);
  }
  for (const table of ["share_permissions", "medical_records"]) {
    const { error } = await db.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
  }
  console.log(`Cleared ${files?.length ?? 0} files and all records/shares for this account.`);
}

async function insertRecord(db: SupabaseClient, userId: string, patientId: Hex, r: DemoRecord, displayName: string, anchor: boolean) {
  const id = randomUUID();
  const path = `${userId}/${id}.svg`;
  const buf = Buffer.from(renderDocumentSvg(r, displayName), "utf8");
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/svg+xml", upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const salt = randomHex32();
  const c = commitment(sha256Hex(buf), salt);
  const { error } = await db.from("medical_records").insert({
    id, user_id: userId, doc_type: r.doc_type, doc_date: r.doc_date, doctor: r.doctor, facility: r.facility, summary: r.summary,
    extracted: { ...r, uncertain_fields: [] }, uncertain_fields: [], file_path: path, file_mime: "image/svg+xml",
    file_sha256: sha256Hex(buf), record_salt: salt, commitment: c,
  });
  if (error) throw new Error(`Record insert failed: ${error.message}`);

  if (r.medications.length) {
    const { error: e } = await db.from("medications").insert(r.medications.map((m) => ({ ...m, record_id: id, user_id: userId, uncertain: false })));
    if (e) throw new Error(`Medication insert failed: ${e.message}`);
  }
  if (r.lab_results.length) {
    const { error: e } = await db.from("lab_results").insert(r.lab_results.map((l) => ({ ...l, record_id: id, user_id: userId, result_date: r.doc_date })));
    if (e) throw new Error(`Lab insert failed: ${e.message}`);
  }

  if (!anchor) return null;
  const tx = await chain.registerRecord(patientId, c);
  const { error: txErr } = await db.from("medical_records").update({ tx_hash: tx }).eq("id", id);
  if (txErr) throw new Error(`Anchored (${tx}) but could not save tx hash: ${txErr.message}`);
  return tx;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  if (args.anchor) {
    requireEnv("RELAYER_PRIVATE_KEY");
    requireEnv("CONTRACT_ADDRESS");
  }

  const user = await findUser(db, args.email);
  const patientId = patientChainId(user.id);
  const displayName = "Ayesha Khan (fictional)";
  const { error: profErr } = await db.from("profiles").upsert({ user_id: user.id, display_name: displayName, patient_chain_id: patientId }, { onConflict: "user_id" });
  if (profErr) throw new Error(`Profile upsert failed: ${profErr.message}`);

  const { count, error: countErr } = await db.from("medical_records").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if (countErr) throw new Error(countErr.message);
  if (count && !args.reset) throw new Error(`This account already has ${count} records. Rerun with --reset to replace them.`);
  if (args.reset) {
    await confirmReset(args.email, count ?? 0);
    await resetAccount(db, user.id);
  }

  for (const [i, r] of DEMO_RECORDS.entries()) {
    const tx = await insertRecord(db, user.id, patientId, r, displayName, args.anchor);
    console.log(`${String(i + 1).padStart(2)}/${DEMO_RECORDS.length}  ${r.doc_date}  ${r.doc_type.padEnd(12)} ${tx ? `anchored ${tx}` : "saved"}`);
  }
  console.log("\nDone. Keep the unclear handwritten prescription (#13) for the live upload.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
