import { GoogleGenAI } from "@google/genai";
import { DOC_TYPES } from "./validate";

let client: GoogleGenAI | null = null;
export const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
export const MODEL = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

export type Medication = {
  name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  uncertain: boolean;
};
export type LabResult = { test_name: string; value: number | null; unit: string | null; ref_range: string | null };
export type Extraction = {
  doc_type: "prescription" | "lab_report" | "discharge" | "consultation" | "other";
  doc_date: string | null;
  doctor: string | null;
  facility: string | null;
  complaint_or_reason: string | null;
  diagnosis_as_written: string | null;
  medications: Medication[];
  lab_results: LabResult[];
  follow_up: string | null;
  summary: string;
  uncertain_fields: string[];
};

const EXTRACT_SYSTEM = `You extract information from a single medical document image or PDF.
Rules:
- Copy values exactly as written. Never guess. Never add medical advice.
- If a field is unreadable or ambiguous, set it to null and add its name to "uncertain_fields".
- Medicine names you are not certain about: keep your best reading but set "uncertain": true.
- Dates: ISO format YYYY-MM-DD if readable, else null.
Return ONLY a JSON object with exactly these keys:
{
 "doc_type": "prescription|lab_report|discharge|consultation|other",
 "doc_date": string|null, "doctor": string|null, "facility": string|null,
 "complaint_or_reason": string|null, "diagnosis_as_written": string|null,
 "medications": [{"name": string, "dose": string|null, "frequency": string|null, "duration": string|null, "uncertain": boolean}],
 "lab_results": [{"test_name": string, "value": number|null, "unit": string|null, "ref_range": string|null}],
 "follow_up": string|null,
 "summary": "one plain sentence describing the document",
 "uncertain_fields": [string]
}`;

export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned) as T;
}

export async function extractDocument(base64: string, mimeType: string): Promise<Extraction> {
  const res = await ai().models.generateContent({
    model: MODEL(),
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType, data: base64 } }, { text: "Extract this medical document." }],
      },
    ],
    config: { systemInstruction: EXTRACT_SYSTEM, responseMimeType: "application/json", temperature: 0 },
  });
  const d = parseJson<Partial<Extraction>>(res.text ?? "{}");
  const docType = DOC_TYPES.includes(d.doc_type as Extraction["doc_type"]) ? (d.doc_type as Extraction["doc_type"]) : "other";
  const docDate = typeof d.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.doc_date) ? d.doc_date : null;
  return {
    doc_type: docType,
    doc_date: docDate,
    doctor: d.doctor ?? null,
    facility: d.facility ?? null,
    complaint_or_reason: d.complaint_or_reason ?? null,
    diagnosis_as_written: d.diagnosis_as_written ?? null,
    medications: d.medications ?? [],
    lab_results: d.lab_results ?? [],
    follow_up: d.follow_up ?? null,
    summary: d.summary ?? "",
    uncertain_fields: d.uncertain_fields ?? [],
  };
}
