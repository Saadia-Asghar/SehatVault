/**
 * Fictional demo history for "Ayesha Khan" (BUILD_PLAN §9). Every name, clinic and value is made up.
 * Record #13 (the deliberately unclear handwritten prescription) is left out for the live upload.
 */
export type DemoMed = { name: string; dose: string | null; frequency: string | null; duration: string | null };
export type DemoLab = { test_name: string; value: number; unit: string; ref_range: string | null };
export type DemoRecord = {
  doc_type: "prescription" | "lab_report" | "discharge" | "consultation" | "other";
  doc_date: string;
  doctor: string;
  facility: string;
  complaint_or_reason: string | null;
  diagnosis_as_written: string | null;
  follow_up: string | null;
  summary: string;
  medications: DemoMed[];
  lab_results: DemoLab[];
};

const med = (name: string, dose: string, frequency: string, duration: string | null = null): DemoMed => ({ name, dose, frequency, duration });
const lab = (test_name: string, value: number, unit: string, ref_range: string | null = null): DemoLab => ({ test_name, value, unit, ref_range });

const GP = { doctor: "Dr. Sana Malik (fictional)", facility: "Green Crescent Family Clinic (sample)" };
const LAB = { doctor: "Pathology Dept.", facility: "Indus Valley Diagnostics (sample)" };
const PHYS = { doctor: "Dr. Imran Qureshi (fictional)", facility: "Margalla Medical Centre (sample)" };

export const DEMO_RECORDS: DemoRecord[] = [
  { doc_type: "prescription", doc_date: "2022-03-14", ...GP, complaint_or_reason: "Fever and cough for 4 days", diagnosis_as_written: "Upper respiratory tract infection",
    follow_up: "Return if fever persists after 3 days", summary: "Handwritten GP prescription for a 5-day antibiotic course for fever and cough.",
    medications: [med("Azithromycin", "500 mg", "Once daily", "5 days"), med("Paracetamol", "500 mg", "When needed for fever", null)], lab_results: [] },
  { doc_type: "lab_report", doc_date: "2022-09-02", ...LAB, complaint_or_reason: "Routine check (tiredness)", diagnosis_as_written: null, follow_up: null,
    summary: "Complete blood count showing mildly low haemoglobin.", medications: [],
    lab_results: [lab("Haemoglobin", 11.2, "g/dL", "12.0–15.5"), lab("WBC", 7.1, "x10^9/L", "4.0–11.0"), lab("Platelets", 245, "x10^9/L", "150–400")] },
  { doc_type: "prescription", doc_date: "2023-02-20", doctor: "Dr. Farah Siddiqui (fictional)", facility: "Ravi Gastro Care (sample)",
    complaint_or_reason: "Upper stomach pain after meals", diagnosis_as_written: "Gastritis", follow_up: "Review in 4 weeks",
    summary: "Printed gastroenterology prescription for a 4-week PPI course.", medications: [med("Omeprazole", "20 mg", "Once daily before breakfast", "4 weeks")], lab_results: [] },
  { doc_type: "consultation", doc_date: "2023-06-11", doctor: "Dr. Farah Siddiqui (fictional)", facility: "Ravi Gastro Care (sample)",
    complaint_or_reason: "Gastritis follow-up", diagnosis_as_written: "Symptoms improved", follow_up: "As needed",
    summary: "Gastro follow-up note: symptoms improved, omeprazole stopped.", medications: [], lab_results: [] },
  { doc_type: "lab_report", doc_date: "2024-01-08", ...LAB, complaint_or_reason: "Lipid screening", diagnosis_as_written: null, follow_up: null,
    summary: "Lipid profile with raised LDL cholesterol.", medications: [],
    lab_results: [lab("Total cholesterol", 238, "mg/dL", "<200"), lab("LDL", 162, "mg/dL", "<100"), lab("HDL", 44, "mg/dL", ">40"), lab("Triglycerides", 170, "mg/dL", "<150")] },
  { doc_type: "prescription", doc_date: "2024-01-15", ...PHYS, complaint_or_reason: "High LDL on recent test", diagnosis_as_written: "Hyperlipidaemia",
    follow_up: "Repeat lipids in 1 year", summary: "Handwritten physician prescription starting a statin.", medications: [med("Atorvastatin", "10 mg", "Once daily at night")], lab_results: [] },
  { doc_type: "lab_report", doc_date: "2024-08-05", ...LAB, complaint_or_reason: "Thirst and frequent urination", diagnosis_as_written: null, follow_up: null,
    summary: "HbA1c and fasting glucose above the normal range.", medications: [], lab_results: [lab("HbA1c", 8.2, "%", "<5.7"), lab("Fasting glucose", 156, "mg/dL", "70–99")] },
  { doc_type: "prescription", doc_date: "2024-08-09", ...PHYS, complaint_or_reason: "Raised HbA1c", diagnosis_as_written: "Type 2 diabetes",
    follow_up: "HbA1c in 6 months", summary: "Printed prescription starting metformin; atorvastatin continued.",
    medications: [med("Metformin", "500 mg", "Twice daily with meals"), med("Atorvastatin", "10 mg", "Once daily at night")], lab_results: [] },
  { doc_type: "lab_report", doc_date: "2025-02-12", ...LAB, complaint_or_reason: "6-month diabetes and lipid review", diagnosis_as_written: null, follow_up: null,
    summary: "HbA1c and LDL both lower than the previous tests.", medications: [], lab_results: [lab("HbA1c", 7.5, "%", "<5.7"), lab("LDL", 128, "mg/dL", "<100")] },
  { doc_type: "consultation", doc_date: "2025-05-21", doctor: "Dr. Kamran Baig (fictional)", facility: "Heartline Cardiac Clinic (sample)",
    complaint_or_reason: "Palpitations for 2 weeks", diagnosis_as_written: "ECG normal sinus rhythm", follow_up: "Follow up if palpitations recur",
    summary: "Cardiology consultation with a normal ECG; advised follow-up if palpitations come back.", medications: [], lab_results: [] },
  { doc_type: "discharge", doc_date: "2025-11-03", doctor: "Medical Unit II", facility: "City General Hospital (sample)",
    complaint_or_reason: "High fever, body aches, low platelets", diagnosis_as_written: "Dengue fever (3-day admission)", follow_up: "Platelet count in 1 week",
    summary: "Discharge summary after a 3-day admission for dengue fever.", medications: [med("Paracetamol", "500 mg", "Every 6 hours when needed", "5 days"), med("ORS", "1 sachet", "After each loose stool", null)],
    lab_results: [lab("Platelets", 62, "x10^9/L", "150–400")] },
  { doc_type: "lab_report", doc_date: "2026-03-10", ...LAB, complaint_or_reason: "Annual review", diagnosis_as_written: null, follow_up: null,
    summary: "HbA1c and LDL continue to improve.", medications: [], lab_results: [lab("HbA1c", 7.1, "%", "<5.7"), lab("LDL", 110, "mg/dL", "<100")] },
  { doc_type: "other", doc_date: "2026-06-18", ...GP, complaint_or_reason: "Rash after amoxicillin", diagnosis_as_written: "Penicillin allergy", follow_up: "Avoid penicillin-group antibiotics",
    summary: "Allergy record noting a penicillin allergy.", medications: [], lab_results: [] },
  { doc_type: "prescription", doc_date: "2026-10-07", ...PHYS, complaint_or_reason: "Routine diabetes and cholesterol review", diagnosis_as_written: "Type 2 diabetes, hyperlipidaemia — stable",
    follow_up: "Review in 3 months", summary: "Printed physician review: continue current medicines.",
    medications: [med("Metformin", "500 mg", "Twice daily with meals"), med("Atorvastatin", "10 mg", "Once daily at night")], lab_results: [] },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A simple, clearly-fictional document image for a record (no scripts, plain shapes and text). */
export function renderDocumentSvg(r: DemoRecord, patient: string): string {
  const lines = [
    `Patient: ${patient}`,
    `Date: ${r.doc_date}`,
    `Doctor: ${r.doctor}`,
    r.complaint_or_reason && `Reason: ${r.complaint_or_reason}`,
    r.diagnosis_as_written && `Diagnosis: ${r.diagnosis_as_written}`,
    ...r.medications.map((m) => `Rx  ${[m.name, m.dose, m.frequency, m.duration].filter(Boolean).join(" · ")}`),
    ...r.lab_results.map((l) => `${l.test_name}: ${l.value} ${l.unit}${l.ref_range ? `  (ref ${l.ref_range})` : ""}`),
    r.follow_up && `Follow-up: ${r.follow_up}`,
  ].filter((x): x is string => !!x);
  const text = lines.map((t, i) => `<text x="48" y="${200 + i * 34}" font-size="20">${esc(t)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000" font-family="Helvetica, Arial, sans-serif">
<rect width="800" height="1000" fill="#fffdf7"/><rect x="0" y="0" width="800" height="110" fill="#087f75"/>
<text x="48" y="58" font-size="30" font-weight="700" fill="#fff">${esc(r.facility)}</text>
<text x="48" y="92" font-size="18" fill="#d9f5f1">${esc(r.doc_type.replace("_", " ").toUpperCase())}</text>
<text x="400" y="620" font-size="96" font-weight="700" fill="#e11d48" fill-opacity="0.12" text-anchor="middle" transform="rotate(-30 400 620)">SAMPLE · FICTIONAL</text>
${text}
<text x="48" y="960" font-size="14" fill="#64748b">Synthetic demo document for SehatVault. Not a real medical record.</text>
</svg>`;
}
