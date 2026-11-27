import { Type, type FunctionDeclaration } from "@google/genai";
import { ai, MODEL } from "./gemini";
import { HttpError, type Ctx } from "./server";
import { compact, loadRecords, verifyRecordFile } from "./records";

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "search_records",
    description:
      "Search the patient's own medical records by keywords (doctor, facility, complaint, diagnosis, medicine, test, specialty words like heart/cardiac/ECG/cholesterol). Returns compact rows with record ids. If nothing matches, returns the full record index.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Space-separated keywords" },
        doc_type: { type: Type.STRING, description: "Optional: prescription | lab_report | discharge | consultation | other" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_record",
    description: "Get full details of one record by id.",
    parameters: { type: Type.OBJECT, properties: { record_id: { type: Type.STRING } }, required: ["record_id"] },
  },
  {
    name: "list_medications",
    description: "List all medications recorded in the patient's documents, with date and doctor. Optional date range YYYY-MM-DD.",
    parameters: {
      type: Type.OBJECT,
      properties: { from: { type: Type.STRING }, to: { type: Type.STRING } },
    },
  },
  {
    name: "compare_lab_results",
    description: "Return all recorded values of one lab test over time (e.g. HbA1c, LDL, hemoglobin), only comparing values with the same unit.",
    parameters: { type: Type.OBJECT, properties: { test_name: { type: Type.STRING } }, required: ["test_name"] },
  },
  {
    name: "generate_visit_brief",
    description: "Write a source-cited consultation brief for an upcoming doctor visit from the given record ids.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        specialty: { type: Type.STRING, description: "e.g. cardiologist" },
        record_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["specialty", "record_ids"],
    },
  },
  {
    name: "request_approval",
    description:
      "Ask the patient to approve sharing selected records with a doctor through a time-limited QR link. Always call this instead of sharing directly. Include the brief you generated.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        record_ids: { type: Type.ARRAY, items: { type: Type.STRING } },
        duration_hours: { type: Type.NUMBER, description: "1, 24 or 168" },
        brief: { type: Type.STRING },
      },
      required: ["record_ids", "duration_hours"],
    },
  },
  {
    name: "verify_document",
    description: "Check that a stored document has not been modified since it was registered on Avalanche.",
    parameters: { type: Type.OBJECT, properties: { record_id: { type: Type.STRING } }, required: ["record_id"] },
  },
];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function runTool(name: string, args: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case "search_records": {
      const all = await loadRecords(ctx);
      const type = str(args.doc_type);
      const pool = type ? all.filter((r) => r.doc_type === type) : all;
      const words = str(args.query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hits = pool.filter((r) => {
        const hay = JSON.stringify(compact(r)).toLowerCase();
        return words.some((w) => hay.includes(w));
      });
      if (!hits.length) return { note: "No keyword match. Full record index provided.", records: all.slice(0, 40).map(compact) };
      return { records: hits.slice(0, 20).map(compact) };
    }
    case "get_record": {
      const [r] = await loadRecords(ctx, [str(args.record_id)]);
      if (!r) throw new HttpError(404, "Record not found");
      return { ...compact(r), extracted: r.extracted };
    }
    case "list_medications": {
      const from = str(args.from);
      const to = str(args.to);
      const all = await loadRecords(ctx);
      return all
        .filter((r) => (!from || (r.doc_date ?? "") >= from) && (!to || (r.doc_date ?? "") <= to))
        .flatMap((r) => r.medications.map((m) => ({ ...m, date: r.doc_date, doctor: r.doctor, record_id: r.id })));
    }
    case "compare_lab_results": {
      const test = str(args.test_name).toLowerCase();
      const all = await loadRecords(ctx);
      const values = all
        .flatMap((r) => r.lab_results.map((l) => ({ ...l, date: r.doc_date, record_id: r.id })))
        .filter((l) => l.test_name.toLowerCase().includes(test))
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      const units = [...new Set(values.map((v) => v.unit ?? ""))];
      return { test: args.test_name, values, comparable: units.length <= 1, units };
    }
    case "generate_visit_brief": {
      const recs = await loadRecords(ctx, strArr(args.record_ids));
      if (!recs.length) return { error: "No matching records" };
      const sources = recs.map((r, i) => ({ label: `R${i + 1}`, ...compact(r) }));
      const res = await ai().models.generateContent({
        model: MODEL(),
        contents: [{ role: "user", parts: [{ text: `Upcoming visit: ${str(args.specialty)}\nRecords:\n${JSON.stringify(sources)}` }] }],
        config: {
          temperature: 0.2,
          systemInstruction: `Write a concise consultation brief for a doctor using ONLY the records given.
Sections (skip empty ones): Reason for visit, Relevant history, Medications recorded, Recent tests, Allergies recorded, Questions the patient may ask.
Short bullet points. End every bullet with its source label like [R2].
Never diagnose, never recommend treatment or dose changes. Plain text with "-" bullets, no other markdown.`,
        },
      });
      return { brief: res.text ?? "", sources: sources.map((s) => ({ label: s.label, id: s.id, date: s.date, type: s.type, doctor: s.doctor })) };
    }
    case "verify_document":
      return verifyRecordFile(ctx, str(args.record_id));
    default:
      throw new HttpError(400, `Unknown tool ${name}`);
  }
}
