import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Handler } from "../helpers/fakeSupabase";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.db }));
vi.mock("@/lib/chain", () => ({
  chain: { createShare: vi.fn(), revokeShare: vi.fn(), isShareActive: vi.fn() },
  explorerTx: (h?: string | null) => (h ? `https://explorer.test/tx/${h}` : null),
  explorerAddress: () => null,
}));

import { chain } from "@/lib/chain";
import { POST as createShare, GET as listShares } from "@/app/api/share/route";
import { POST as revokeShare } from "@/app/api/share/[id]/revoke/route";

const REC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SHARE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUTH = { authorization: "Bearer test-token", "content-type": "application/json" };

const post = (body: unknown) => createShare(new Request("http://app.test/api/share", { method: "POST", headers: AUTH, body: JSON.stringify(body) }), { params: Promise.resolve({}) });
const revoke = (id = SHARE_ID) => revokeShare(new Request(`http://app.test/api/share/${id}/revoke`, { method: "POST", headers: AUTH }), { params: Promise.resolve({ id }) });

function setup(tables: Record<string, Handler> = {}) {
  const fake = fakeSupabase({
    // Owns REC_A and REC_B; returns the requested ones, like `.in("id", ids)` would.
    medical_records: (q) => ({ data: ((q.arg("in", 1) as string[]) ?? []).filter((id) => [REC_A, REC_B].includes(id)).map((id) => ({ id })) }),
    share_permissions: (q) => (q.has("insert") ? { data: { id: SHARE_ID, expires_at: "2026-11-28T00:00:00.000Z" } } : { data: null }),
    share_records: () => ({ data: null }),
    ...tables,
  });
  state.db = fake.client;
  return fake;
}

const shareOps = (fake: ReturnType<typeof setup>, op: string) => fake.ofTable("share_permissions").filter((q) => q.has(op));

describe("POST /api/share", () => {
  beforeEach(() => {
    vi.mocked(chain.createShare).mockReset().mockResolvedValue("0xshare");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("requires sign-in", async () => {
    setup();
    const res = await createShare(new Request("http://app.test/api/share", { method: "POST", body: "{}" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("saves as pending, registers on-chain, then activates", async () => {
    const fake = setup();
    const res = await post({ record_ids: [REC_A, REC_B], duration_hours: 24, brief: "brief" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(/\/s\/[A-Za-z0-9_-]{32}$/);
    expect(body.qr).toMatch(/^data:image\/png;base64,/);
    expect((shareOps(fake, "insert")[0].arg("insert") as { status: string }).status).toBe("pending");
    expect(shareOps(fake, "update")[0].arg("update")).toEqual({ status: "active", tx_hash: "0xshare" });
    expect(chain.createShare).toHaveBeenCalledTimes(1);
  });

  it("never stores the raw token", async () => {
    const fake = setup();
    const body = await (await post({ record_ids: [REC_A], duration_hours: 1 })).json();
    const token = body.url.split("/s/")[1];
    const inserted = JSON.stringify(shareOps(fake, "insert")[0].arg("insert"));
    expect(inserted).not.toContain(token);
  });

  it("refuses records the user does not own", async () => {
    setup({ medical_records: () => ({ data: [{ id: REC_A }] }) });
    const res = await post({ record_ids: [REC_A, REC_B], duration_hours: 24 });
    expect(res.status).toBe(403);
    expect(chain.createShare).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    setup();
    expect((await post({ record_ids: ["not-a-uuid"], duration_hours: 24 })).status).toBe(400);
    expect((await post({ record_ids: [REC_A], duration_hours: 9999 })).status).toBe(400);
  });

  it("removes the pending share when the chain transaction fails", async () => {
    vi.mocked(chain.createShare).mockRejectedValue(new Error("insufficient funds"));
    const fake = setup();
    const res = await post({ record_ids: [REC_A], duration_hours: 24 });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Avalanche/);
    expect(shareOps(fake, "delete")).toHaveLength(1);
    expect(shareOps(fake, "update")).toHaveLength(0);
  });

  it("removes the share and skips the chain when saving its record list fails", async () => {
    const fake = setup({ share_records: () => ({ error: { message: "fk violation" } }) });
    const res = await post({ record_ids: [REC_A], duration_hours: 24 });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("fk violation");
    expect(shareOps(fake, "delete")).toHaveLength(1);
    expect(chain.createShare).not.toHaveBeenCalled();
  });
});

describe("GET /api/share", () => {
  it("lists only confirmed shares with derived state and view counts", async () => {
    const fake = setup({
      share_permissions: () => ({
        data: [{ id: SHARE_ID, status: "active", expires_at: "2099-01-01T00:00:00Z", tx_hash: "0x1", revoke_tx_hash: null, share_records: [{}, {}], access_logs: [{ result: "granted" }, { result: "expired" }] }],
      }),
    });
    const body = await (await listShares(new Request("http://app.test/api/share", { headers: AUTH }), { params: Promise.resolve({}) })).json();
    expect(body.shares[0]).toEqual(expect.objectContaining({ state: "active", record_count: 2, views: 1 }));
    expect(fake.ofTable("share_permissions")[0].arg("neq", 1)).toBe("pending");
  });
});

describe("POST /api/share/[id]/revoke", () => {
  beforeEach(() => {
    vi.mocked(chain.revokeShare).mockReset().mockResolvedValue("0xrevoke");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(chain.isShareActive).mockReset().mockResolvedValue(true);
  });

  const withShare = (share: object | null) => setup({ share_permissions: (q) => (q.has("update") ? { data: null } : { data: share }) });

  const updates = (fake: ReturnType<typeof setup>) => shareOps(fake, "update").map((q) => q.arg("update"));

  it("closes the link in the database first, then revokes on-chain", async () => {
    const fake = withShare({ id: SHARE_ID, share_chain_id: "0x01", status: "active", revoke_tx_hash: null });
    const res = await revoke();
    expect(await res.json()).toEqual(expect.objectContaining({ ok: true, chainPending: false }));
    expect(chain.revokeShare).toHaveBeenCalledTimes(1);
    expect(updates(fake)).toEqual([{ status: "revoked" }, { revoke_tx_hash: "0xrevoke" }]);
  });

  it("still revokes when the relayer can't pay for the transaction", async () => {
    vi.mocked(chain.revokeShare).mockImplementation(async () => {
      throw new Error("insufficient funds for gas");
    });
    const fake = withShare({ id: SHARE_ID, share_chain_id: "0x01", status: "active", revoke_tx_hash: null });
    const res = await revoke();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ ok: true, chainPending: true }));
    expect(updates(fake)).toEqual([{ status: "revoked" }]);
  });

  it("only updates the database when the chain already treats the share as inactive", async () => {
    vi.mocked(chain.isShareActive).mockResolvedValue(false);
    const fake = withShare({ id: SHARE_ID, share_chain_id: "0x01", status: "active", revoke_tx_hash: null });
    expect((await revoke()).status).toBe(200);
    expect(chain.revokeShare).not.toHaveBeenCalled();
    expect(updates(fake)).toEqual([{ status: "revoked" }]);
  });

  it("retries the on-chain revoke for a share revoked only in the database", async () => {
    const fake = withShare({ id: SHARE_ID, share_chain_id: "0x01", status: "revoked", revoke_tx_hash: null });
    expect((await revoke()).status).toBe(200);
    expect(chain.revokeShare).toHaveBeenCalledTimes(1);
    expect(updates(fake)).toEqual([{ revoke_tx_hash: "0xrevoke" }]);
  });

  it("404s for someone else's or a malformed share id", async () => {
    withShare(null);
    expect((await revoke()).status).toBe(404);
    expect((await revoke("1;drop table")).status).toBe(404);
  });

  it("refuses to revoke twice", async () => {
    withShare({ id: SHARE_ID, share_chain_id: "0x01", status: "revoked", revoke_tx_hash: "0xold" });
    expect((await revoke()).status).toBe(400);
  });
});
