import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, checkUpload, isShareToken, parseExtraction, parseId } from "@/lib/validate";

const valid = {
  doc_type: "lab_report",
  doc_date: "2026-03-10",
  doctor: "  Dr. Test  ",
  facility: "",
  complaint_or_reason: null,
  diagnosis_as_written: null,
  medications: [{ name: "Metformin", dose: "500 mg", frequency: null, duration: null }],
  lab_results: [{ test_name: "HbA1c", value: 7.1, unit: "%", ref_range: null }],
  follow_up: null,
  summary: "Lab report",
  uncertain_fields: [],
};

describe("parseExtraction", () => {
  it("accepts a confirmed record and normalises blanks to null", () => {
    const r = parseExtraction(JSON.stringify(valid));
    expect(r.doctor).toBe("Dr. Test");
    expect(r.facility).toBeNull();
    expect(r.medications[0].uncertain).toBe(false);
  });

  it("rejects missing data", () => {
    expect(() => parseExtraction(null)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("rejects invalid JSON with a 400, not a crash", () => {
    expect(() => parseExtraction("{not json")).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("rejects an unknown document type", () => {
    expect(() => parseExtraction(JSON.stringify({ ...valid, doc_type: "x-ray" }))).toThrow(/doc_type/);
  });

  it("rejects impossible dates that Postgres would refuse", () => {
    expect(() => parseExtraction(JSON.stringify({ ...valid, doc_date: "2026-02-31" }))).toThrow(/doc_date/);
  });

  it("rejects non-numeric lab values", () => {
    const bad = { ...valid, lab_results: [{ test_name: "HbA1c", value: "high", unit: "%" }] };
    expect(() => parseExtraction(JSON.stringify(bad))).toThrow(/lab_results/);
  });

  it("strips NUL characters that Postgres would reject", () => {
    const r = parseExtraction(JSON.stringify({ ...valid, doctor: "Dr.\u0000 X", summary: "a\u0000b" }));
    expect(r.doctor).toBe("Dr. X");
    expect(r.summary).toBe("ab");
  });

  it("caps oversized text", () => {
    expect(() => parseExtraction(JSON.stringify({ ...valid, summary: "x".repeat(2001) }))).toThrow(/summary/);
  });
});

describe("checkUpload", () => {
  it("accepts images and PDFs and derives the extension from the type", () => {
    const r = checkUpload(new File(["x"], "evil.html", { type: "image/png" }));
    expect(r.ext).toBe("png");
    expect(checkUpload(new File(["x"], "a.pdf", { type: "application/pdf" })).ext).toBe("pdf");
  });

  it("rejects other file types", () => {
    expect(() => checkUpload(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).toThrowError(expect.objectContaining({ status: 415 }));
  });

  it("rejects empty, missing and oversized files", () => {
    expect(() => checkUpload(null)).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => checkUpload(new File([], "a.png", { type: "image/png" }))).toThrowError(expect.objectContaining({ status: 400 }));
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "a.png", { type: "image/png" });
    expect(() => checkUpload(big)).toThrowError(expect.objectContaining({ status: 413 }));
  });
});

describe("ids and tokens", () => {
  it("parseId accepts UUIDs and 404s on anything else", () => {
    expect(parseId("11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    expect(() => parseId("1 or 1=1")).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => parseId(null)).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("isShareToken matches only the generated token shape", () => {
    expect(isShareToken("A".repeat(32))).toBe(true);
    expect(isShareToken("A".repeat(31))).toBe(false);
    expect(isShareToken("../../etc/passwd________________")).toBe(false);
  });
});
