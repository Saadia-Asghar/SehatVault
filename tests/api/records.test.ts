import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Handler } from "../helpers/fakeSupabase";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.db }));
vi.mock("@/lib/chain", () => ({
  chain: { registerRecord: vi.fn(), verifyRecord: vi.fn() },
  explorerTx: (h?: string | null) => (h ? `https://explorer.test/tx/${h}` : null),
  explorerAddress: () => null,
}));

import { chain } from "@/lib/chain";
import { POST as saveRecord } from "@/app/api/records/route";
import { POST as retryAnchor, GET as openFile } from "@/app/api/records/[id]/route";

const AUTH = { authorization: "Bearer test-token" };
const REC_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DATA = {
  doc_type: "prescription",
  doc_date: "2026-10-07",
  doctor: "Dr. Test",
  facility: null,
  complaint_or_reason: null,
  diagnosis_as_written: null,
  medications: [{ name: "Metformin", dose: "500 mg", frequency: "Twice daily", duration: null, uncertain: false }, { name: "", dose: null, frequency: null, duration: null }],
  lab_results: [],
  follow_up: null,
  summary: "Prescription",
  uncertain_fields: [],
};

function form(file: File | null, data: unknown = DATA) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  fd.append("data", typeof data === "string" ? data : JSON.stringify(data));
  return saveRecord(new Request("http://app.test/api/records", { method: "POST", headers: AUTH, body: fd }), { params: Promise.resolve({}) });
}
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "rx.png", { type: "image/png" });

function setup(tables: Record<string, Handler> = {}) {
  const fake = fakeSupabase({ medical_records: () => ({ data: null }), medications: () => ({ data: null }), lab_results: () => ({ data: null }), ...tables });
  state.db = fake.client;
  return fake;
}

describe("POST /api/records", () => {
  beforeEach(() => {
    vi.mocked(chain.registerRecord).mockReset().mockResolvedValue("0xrec");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("saves the record, skips blank medicines and anchors it", async () => {
    const fake = setup();
    const res = await form(png());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ tx_hash: "0xrec", anchorError: null }));
    const meds = fake.ofTable("medications")[0].arg("insert") as unknown[];
    expect(meds).toHaveLength(1);
    expect(fake.storageCalls[0].args[0]).toMatch(/^11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.png$/);
  });

  it("rejects unsupported file types before uploading", async () => {
    const fake = setup();
    const res = await form(new File(["<html>"], "x.html", { type: "text/html" }));
    expect(res.status).toBe(415);
    expect(fake.storageCalls).toHaveLength(0);
  });

  it("rejects invalid record data before uploading", async () => {
    const fake = setup();
    expect((await form(png(), "{broken")).status).toBe(400);
    expect((await form(png(), { ...DATA, doc_type: "selfie" })).status).toBe(400);
    expect(fake.storageCalls).toHaveLength(0);
  });

  it("rolls back the record and file when saving medicines fails", async () => {
    const fake = setup({ medications: () => ({ error: { message: "insert denied" } }) });
    const res = await form(png());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("insert denied");
    expect(fake.ofTable("medical_records").some((q) => q.has("delete"))).toBe(true);
    expect(fake.storageCalls.map((c) => c.name)).toEqual(["upload", "remove"]);
    expect(chain.registerRecord).not.toHaveBeenCalled();
  });

  it("keeps the record but reports a friendly message when anchoring fails", async () => {
    vi.mocked(chain.registerRecord).mockRejectedValue(new Error("RPC timeout at https://api.avax-test.network"));
    setup();
    const body = await (await form(png())).json();
    expect(body.tx_hash).toBeNull();
    expect(body.anchorError).toBe("Avalanche network unavailable");
  });
});

describe("/api/records/[id]", () => {
  const call = (fn: typeof retryAnchor, id = REC_ID) => fn(new Request(`http://app.test/api/records/${id}`, { method: "POST", headers: AUTH }), { params: Promise.resolve({ id }) });

  beforeEach(() => {
    vi.mocked(chain.registerRecord).mockReset().mockResolvedValue("0xnew");
    vi.mocked(chain.verifyRecord).mockReset().mockResolvedValue(false);
  });

  it("returns a signed link to the owner's file", async () => {
    setup({ medical_records: () => ({ data: { file_path: "u/x.pdf" } }) });
    expect(await (await call(openFile)).json()).toEqual({ url: expect.stringContaining("u/x.pdf") });
  });

  it("anchors a record that was not anchored yet", async () => {
    setup({ medical_records: (q) => (q.has("update") ? { data: null } : { data: { commitment: "0x01", tx_hash: null } }) });
    expect(await (await call(retryAnchor)).json()).toEqual(expect.objectContaining({ tx_hash: "0xnew" }));
  });

  it("does not re-register a commitment already on-chain (contract would revert)", async () => {
    vi.mocked(chain.verifyRecord).mockResolvedValue(true);
    setup({ medical_records: () => ({ data: { commitment: "0x01", tx_hash: null } }) });
    expect(await (await call(retryAnchor)).json()).toEqual(expect.objectContaining({ alreadyAnchored: true }));
    expect(chain.registerRecord).not.toHaveBeenCalled();
  });

  it("404s on malformed ids", async () => {
    setup();
    expect((await call(openFile, "../etc")).status).toBe(404);
  });
});
