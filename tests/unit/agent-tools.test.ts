import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "../helpers/fakeSupabase";

const gen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gemini", () => ({ ai: () => ({ models: { generateContent: gen } }), MODEL: () => "test-model" }));
vi.mock("@/lib/chain", () => ({ chain: { verifyRecord: vi.fn(), createShare: vi.fn() } }));

import { chain } from "@/lib/chain";
import { runTool } from "@/lib/tools";
import { runAgent } from "@/lib/agent";
import { verifyRecordFile } from "@/lib/records";
import { commitment, sha256Hex, type Hex } from "@/lib/hash";
import type { Ctx } from "@/lib/server";

const LIPID = {
  id: "r-lipid", doc_type: "lab_report", doc_date: "2024-01-08", doctor: "Lab", facility: "Diag", summary: "Lipid profile",
  extracted: { complaint_or_reason: "cholesterol screening" }, uncertain_fields: [], tx_hash: "0x1", created_at: "",
  medications: [], lab_results: [{ test_name: "LDL", value: 162, unit: "mg/dL", ref_range: "<100" }],
};
const LIPID2 = { ...LIPID, id: "r-lipid2", doc_date: "2026-03-10", lab_results: [{ test_name: "LDL", value: 110, unit: "mg/dL", ref_range: null }] };
const RX = {
  ...LIPID, id: "r-rx", doc_type: "prescription", doc_date: "2024-08-09", summary: "Metformin started", extracted: {},
  medications: [{ name: "Metformin", dose: "500 mg", frequency: "Twice daily", duration: null, uncertain: false }], lab_results: [],
};
const ALL = [LIPID2, RX, LIPID];

function ctxWith(records = ALL): Ctx {
  const fake = fakeSupabase({
    medical_records: (q) => {
      const ids = q.arg("in", 1) as string[] | undefined;
      return { data: ids ? records.filter((r) => ids.includes(r.id)) : records };
    },
  });
  return { db: fake.client as unknown as Ctx["db"], userId: "u1", patientId: "0x00" as Hex };
}

describe("agent tools", () => {
  beforeEach(() => {
    gen.mockReset();
  });

  it("search_records matches keywords across fields", async () => {
    const r = (await runTool("search_records", { query: "metformin" }, ctxWith())) as { records: { id: string }[] };
    expect(r.records.map((x) => x.id)).toEqual(["r-rx"]);
  });

  it("search_records falls back to the full index when nothing matches", async () => {
    const r = (await runTool("search_records", { query: "zzz", doc_type: "lab_report" }, ctxWith())) as { note?: string; records: unknown[] };
    expect(r.note).toMatch(/No keyword match/);
    expect(r.records).toHaveLength(3);
  });

  it("compare_lab_results orders values over time and flags unit mismatches", async () => {
    const r = (await runTool("compare_lab_results", { test_name: "ldl" }, ctxWith())) as { values: { value: number }[]; comparable: boolean };
    expect(r.values.map((v) => v.value)).toEqual([162, 110]);
    expect(r.comparable).toBe(true);
    const mixed = [LIPID, { ...LIPID2, lab_results: [{ test_name: "LDL", value: 2.8, unit: "mmol/L", ref_range: null }] }];
    expect(((await runTool("compare_lab_results", { test_name: "LDL" }, ctxWith(mixed))) as { comparable: boolean }).comparable).toBe(false);
  });

  it("list_medications respects the date range", async () => {
    const all = (await runTool("list_medications", {}, ctxWith())) as unknown[];
    expect(all).toHaveLength(1);
    expect(await runTool("list_medications", { to: "2024-01-01" }, ctxWith())).toEqual([]);
  });

  it("get_record returns details or 404s", async () => {
    expect(await runTool("get_record", { record_id: "r-rx" }, ctxWith())).toEqual(expect.objectContaining({ id: "r-rx" }));
    await expect(runTool("get_record", { record_id: "nope" }, ctxWith())).rejects.toMatchObject({ status: 404 });
  });

  it("generate_visit_brief cites only the given records", async () => {
    gen.mockResolvedValue({ text: "- LDL fell from 162 to 110 mg/dL [R1][R2]" });
    const r = (await runTool("generate_visit_brief", { specialty: "cardiologist", record_ids: ["r-lipid", "r-lipid2"] }, ctxWith())) as { brief: string; sources: unknown[] };
    expect(r.brief).toContain("[R1]");
    expect(r.sources).toHaveLength(2);
    expect(await runTool("generate_visit_brief", { specialty: "x", record_ids: [] }, ctxWith([]))).toEqual({ error: "No matching records" });
  });

  it("rejects unknown tools", async () => {
    await expect(runTool("create_share", {}, ctxWith())).rejects.toMatchObject({ status: 400 });
  });
});

describe("runAgent", () => {
  beforeEach(() => {
    gen.mockReset();
  });

  const callTurn = (name: string, args: object) => ({ functionCalls: [{ name, args }], candidates: [{ content: { role: "model", parts: [] } }] });

  it("answers directly when no tool is needed", async () => {
    gen.mockResolvedValue({ text: "Hello", functionCalls: [] });
    expect(await runAgent(ctxWith(), "hi", [])).toEqual({ steps: [], answer: "Hello" });
  });

  it("runs tools, then stops for patient approval without sharing anything", async () => {
    gen
      .mockResolvedValueOnce(callTurn("search_records", { query: "cholesterol" }))
      .mockResolvedValueOnce(callTurn("request_approval", { record_ids: ["r-lipid", "not-mine"], duration_hours: 500, brief: "b" }));
    const r = await runAgent(ctxWith(), "prepare for cardiologist", [{ role: "user", text: "earlier" }]);
    expect(r.steps.map((s) => s.name)).toEqual(["search_records", "request_approval"]);
    expect(r.approval?.record_ids).toEqual(["r-lipid"]); // ids not owned by the patient are dropped
    expect(r.approval?.duration_hours).toBe(168); // clamped to 7 days
    expect(chain.createShare).not.toHaveBeenCalled();
  });

  it("reports failing tools as failed steps and keeps going", async () => {
    gen.mockResolvedValueOnce(callTurn("get_record", { record_id: "missing" })).mockResolvedValueOnce({ text: "I couldn't find that.", functionCalls: [] });
    const r = await runAgent(ctxWith(), "q", []);
    expect(r.steps[0]).toEqual(expect.objectContaining({ name: "get_record", ok: false }));
    expect(r.answer).toMatch(/couldn't find/);
  });

  it("stops after the step limit", async () => {
    gen.mockResolvedValue(callTurn("list_medications", {}));
    const r = await runAgent(ctxWith(), "loop", []);
    expect(r.answer).toMatch(/stopped after several steps/);
    expect(gen).toHaveBeenCalledTimes(8);
  });
});

describe("verifyRecordFile", () => {
  const salt = ("0x" + "11".repeat(32)) as Hex;
  const stored = commitment(sha256Hex(Buffer.from("file")), salt); // fake storage download returns "file"
  const ctx = (): Ctx => ({
    db: fakeSupabase({ medical_records: () => ({ data: { id: "r1", file_path: "u1/r1.png", record_salt: salt, commitment: stored, tx_hash: "0x9" } }) }).client as unknown as Ctx["db"],
    userId: "u1",
    patientId: "0x00" as Hex,
  });

  beforeEach(() => {
    vi.mocked(chain.verifyRecord).mockReset().mockResolvedValue(true);
  });

  it("confirms the stored file is intact and on-chain", async () => {
    expect(await verifyRecordFile(ctx(), "r1")).toEqual(expect.objectContaining({ intact: true, anchoredOnChain: true, checked: "stored file" }));
  });

  it("detects a modified copy", async () => {
    expect(await verifyRecordFile(ctx(), "r1", Buffer.from("edited"))).toEqual(expect.objectContaining({ intact: false, checked: "uploaded file" }));
  });

  it("reports unknown chain status when the RPC fails", async () => {
    vi.mocked(chain.verifyRecord).mockImplementation(async () => {
      throw new Error("rpc");
    });
    expect((await verifyRecordFile(ctx(), "r1")).anchoredOnChain).toBeNull();
  });
});
