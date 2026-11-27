import { afterEach, describe, expect, it, vi } from "vitest";

const gen = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: gen };
  },
}));

import { extractDocument, parseJson } from "@/lib/gemini";
import { chain, explorerAddress, explorerTx } from "@/lib/chain";

describe("Gemini extraction", () => {
  it("parseJson strips markdown fences", () => {
    expect(parseJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("normalises unknown document types and unreadable dates", async () => {
    gen.mockResolvedValue({ text: JSON.stringify({ doc_type: "x-ray", doc_date: "March 2024", summary: "s" }) });
    const r = await extractDocument("YQ==", "image/png");
    expect(r.doc_type).toBe("other");
    expect(r.doc_date).toBeNull();
    expect(r.medications).toEqual([]);
    expect(r.uncertain_fields).toEqual([]);
  });

  it("keeps valid values", async () => {
    gen.mockResolvedValue({ text: JSON.stringify({ doc_type: "lab_report", doc_date: "2026-03-10", uncertain_fields: ["doctor"] }) });
    const r = await extractDocument("YQ==", "image/png");
    expect(r).toEqual(expect.objectContaining({ doc_type: "lab_report", doc_date: "2026-03-10", uncertain_fields: ["doctor"] }));
  });
});

describe("chain client", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("explains missing blockchain configuration instead of crashing at import", () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    vi.stubEnv("CONTRACT_ADDRESS", "");
    expect(() => chain.isShareActive("0x01")).toThrow(/Blockchain not configured/);
  });

  it("builds explorer links", () => {
    expect(explorerTx("0xabc")).toBe("https://testnet.snowtrace.io/tx/0xabc");
    expect(explorerTx(null)).toBeNull();
    vi.stubEnv("CONTRACT_ADDRESS", "0xC0");
    expect(explorerAddress()).toBe("https://testnet.snowtrace.io/address/0xC0");
    vi.stubEnv("CONTRACT_ADDRESS", "");
    expect(explorerAddress()).toBeNull();
  });
});
