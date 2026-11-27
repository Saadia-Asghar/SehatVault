import { handle, requireUser, HttpError } from "@/lib/server";
import { extractDocument } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (req) => {
  await requireUser(req);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
  if (file.size > 10 * 1024 * 1024) throw new HttpError(400, "File too large (max 10 MB)");
  const buf = Buffer.from(await file.arrayBuffer());
  const extraction = await extractDocument(buf.toString("base64"), file.type || "image/jpeg");
  return Response.json({ extraction });
});
