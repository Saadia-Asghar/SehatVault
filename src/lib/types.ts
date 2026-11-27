export type Med = { name: string; dose: string | null; frequency: string | null; duration: string | null; uncertain?: boolean };
export type Lab = { test_name: string; value: number | null; unit: string | null; ref_range?: string | null };

export type RecordRow = {
  id: string;
  doc_type: string | null;
  doc_date: string | null;
  doctor: string | null;
  facility: string | null;
  summary: string | null;
  uncertain_fields: string[] | null;
  tx_hash: string | null;
  explorer?: string | null;
  medications: Med[];
  lab_results: Lab[];
};

export const DOC_LABELS: Record<string, string> = {
  prescription: "Prescription",
  lab_report: "Lab report",
  discharge: "Discharge summary",
  consultation: "Consultation",
  other: "Document",
};

export const docLabel = (t: string | null) => DOC_LABELS[t ?? "other"] ?? "Document";

export const formatDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Undated";
