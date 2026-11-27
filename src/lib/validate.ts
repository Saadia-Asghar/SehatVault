import { z } from "zod";
import { HttpError } from "./errors";

/** Vercel rejects request bodies over 4.5 MB, so keep uploads safely below that. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export const DOC_TYPES = ["prescription", "lab_report", "discharge", "consultation", "other"] as const;

/** Postgres text columns reject NUL characters, so strip them before the insert. */
const noNul = (v: string) => v.replace(/\u0000/g, "");

const text = (max: number) => z.string().transform(noNul).pipe(z.string().trim().max(max));

const optText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => v || null);

const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const MedicationSchema = z.object({
  name: text(200),
  dose: optText(100),
  frequency: optText(100),
  duration: optText(100),
  uncertain: z.boolean().default(false),
});

const LabSchema = z.object({
  test_name: text(200),
  value: z.number().finite().nullable().default(null),
  unit: optText(50),
  ref_range: optText(100),
});

/** The patient-confirmed extraction sent when saving a record. */
export const ExtractionSchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  doc_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, "Invalid date")
    .nullable()
    .default(null),
  doctor: optText(200),
  facility: optText(200),
  complaint_or_reason: optText(1000),
  diagnosis_as_written: optText(1000),
  medications: z.array(MedicationSchema).max(50).default([]),
  lab_results: z.array(LabSchema).max(100).default([]),
  follow_up: optText(1000),
  summary: text(2000).default(""),
  uncertain_fields: z.array(z.string().max(100)).max(50).default([]),
});

export type ConfirmedExtraction = z.infer<typeof ExtractionSchema>;

export function parseExtraction(raw: FormDataEntryValue | null): ConfirmedExtraction {
  if (typeof raw !== "string") throw new HttpError(400, "Missing record data");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Record data is not valid JSON");
  }
  const parsed = ExtractionSchema.safeParse(json);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "record";
    throw new HttpError(400, `Please check the "${field}" field`);
  }
  return parsed.data;
}

export type CheckedUpload = { file: File; ext: string; mime: string };

/** Accepts only images and PDFs under the size limit. */
export function checkUpload(value: FormDataEntryValue | null): CheckedUpload {
  if (!(value instanceof File)) throw new HttpError(400, "No file uploaded");
  if (value.size === 0) throw new HttpError(400, "The file is empty");
  if (value.size > MAX_FILE_BYTES) throw new HttpError(413, "File too large (max 4 MB). Try a smaller photo.");
  const mime = value.type.toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw new HttpError(415, "Only photos (JPG, PNG, WebP, HEIC) and PDFs are supported");
  return { file: value, ext, mime };
}

const Uuid = z.string().uuid();

/** Validates a route id so malformed ids give 404 instead of a database error. */
export function parseId(id: string | undefined | null): string {
  const parsed = Uuid.safeParse(id);
  if (!parsed.success) throw new HttpError(404, "Not found");
  return parsed.data;
}

/** Share tokens are 24 random bytes in base64url. */
export const isShareToken = (token: string): boolean => /^[A-Za-z0-9_-]{32}$/.test(token);
