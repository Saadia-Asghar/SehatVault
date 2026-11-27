import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Handler } from "../helpers/fakeSupabase";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.db }));
vi.mock("@/lib/chain", () => ({
  chain: { isShareActive: vi.fn(), logAccess: vi.fn() },
  explorerTx: (h?: string | null) => (h ? `https://explorer.test/tx/${h}` : null),
  explorerAddress: () => "https://explorer.test/address/0xabc",
}));

import { chain } from "@/lib/chain";
import { GET } from "@/app/api/s/[token]/route";

const TOKEN = "T".repeat(32);
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const SHARE = { id: "share-1", user_id: "user-1", share_chain_id: "0x01", brief: "- LDL improving [R1]", expires_at: FUTURE, status: "active" };
const RECORD = { id: "rec-1", doc_type: "lab_report", doc_date: "2026-03-10", doctor: "Lab", facility: "Diag", summary: "s", file_path: "user-1/rec-1.pdf", tx_hash: "0xaa", medications: [], lab_results: [] };

let ipCounter = 0;
const call = (token = TOKEN, ip = `10.0.0.${++ipCounter}`) =>
  GET(new Request(`http://app.test/api/s/${token}`, { headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ token }) });

function setup(opts: { share?: object | null; anchorFree?: boolean; tables?: Record<string, Handler> } = {}) {
  const fake = fakeSupabase({
    // An UPDATE is the atomic "claim the on-chain log slot" step; it returns rows only if the slot was free.
    share_permissions: (q) => (q.has("update") ? { data: opts.anchorFree === false ? [] : [{ id: "share-1" }] } : { data: opts.share === undefined ? SHARE : opts.share }),
    share_records: () => ({ data: [{ medical_records: RECORD }] }),
    profiles: () => ({ data: { display_name: "Ayesha Khan" } }),
    access_logs: () => ({ data: null }),
    ...opts.tables,
  });
  state.db = fake.client;
  return fake;
}

const logInserts = (fake: ReturnType<typeof setup>) =>
  fake.ofTable("access_logs").filter((q) => q.has("insert")).map((q) => q.arg("insert") as { result: string; tx_hash: string | null });

describe("GET /api/s/[token] (doctor view)", () => {
  beforeEach(() => {
    vi.mocked(chain.isShareActive).mockReset().mockResolvedValue(true);
    vi.mocked(chain.logAccess).mockReset().mockResolvedValue("0xlog");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("rejects malformed tokens without touching the database", async () => {
    const fake = setup();
    const res = await call("short");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ state: "invalid" });
    expect(fake.queries).toHaveLength(0);
  });

  it("returns invalid for unknown tokens", async () => {
    setup({ share: null });
    expect((await call()).status).toBe(404);
  });

  it("does not open a share that was never confirmed on-chain", async () => {
    setup({ share: { ...SHARE, status: "pending" } });
    const res = await call();
    expect(await res.json()).toEqual({ state: "invalid" });
    expect(chain.isShareActive).not.toHaveBeenCalled();
  });

  it("logs and denies a revoked share", async () => {
    const fake = setup({ share: { ...SHARE, status: "revoked" } });
    const res = await call();
    expect(res.status).toBe(410);
    expect(logInserts(fake)).toEqual([expect.objectContaining({ result: "revoked" })]);
  });

  it("denies an expired share", async () => {
    setup({ share: { ...SHARE, expires_at: new Date(Date.now() - 1000).toISOString() } });
    expect(await (await call()).json()).toEqual({ state: "expired" });
  });

  it("fails closed when the on-chain check errors", async () => {
    vi.mocked(chain.isShareActive).mockRejectedValue(new Error("RPC down"));
    setup();
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ state: "unavailable" });
    expect(body.records).toBeUndefined();
  });

  it("denies when the contract says the share is inactive", async () => {
    vi.mocked(chain.isShareActive).mockResolvedValue(false);
    setup();
    expect(await (await call()).json()).toEqual({ state: "revoked" });
  });

  it("returns the shared records and anchors the first view on-chain", async () => {
    const fake = setup();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.patient).toBe("Ayesha Khan");
    expect(body.records).toEqual([expect.objectContaining({ id: "rec-1", anchored: true, file_url: expect.stringContaining("https://files.test/") })]);
    expect(body.records[0].file_path).toBeUndefined();
    expect(chain.logAccess).toHaveBeenCalledTimes(1);
    expect(logInserts(fake)).toEqual([expect.objectContaining({ result: "granted", tx_hash: "0xlog" })]);
  });

  it("does not pay for another on-chain log when one was sent recently", async () => {
    const fake = setup({ anchorFree: false });
    const res = await call();
    expect(res.status).toBe(200);
    expect(chain.logAccess).not.toHaveBeenCalled();
    expect(logInserts(fake)).toEqual([expect.objectContaining({ result: "granted", tx_hash: null })]);
  });

  it("claims the log slot with a conditional update so parallel views can't both pay", async () => {
    const fake = setup();
    await call();
    const claim = fake.ofTable("share_permissions").find((q) => q.has("update"));
    expect(claim?.arg("or")).toMatch(/^last_anchor_at\.is\.null,last_anchor_at\.lt\./);
  });

  it("skips the paid log if claiming the slot fails", async () => {
    setup({ tables: { share_permissions: (q) => (q.has("update") ? { error: { message: "db down" } } : { data: SHARE }) } });
    expect((await call()).status).toBe(200);
    expect(chain.logAccess).not.toHaveBeenCalled();
  });

  it("still shows records if the on-chain log transaction fails", async () => {
    vi.mocked(chain.logAccess).mockRejectedValue(new Error("out of gas"));
    const fake = setup();
    expect((await call()).status).toBe(200);
    expect(logInserts(fake)).toEqual([expect.objectContaining({ result: "granted", tx_hash: null })]);
  });

  it("rate-limits a single IP hammering the link", async () => {
    setup();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await call("bad", "203.0.113.7")).status);
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("hides database error details", async () => {
    setup({ tables: { share_permissions: () => ({ error: { message: "permission denied for table share_permissions" } }) } });
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("permission denied");
  });
});
