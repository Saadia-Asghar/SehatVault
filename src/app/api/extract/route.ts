import { handle, requireUser } from "@/lib/server";
import { extractDocument } from "@/lib/gemini";
import { aiLimiter, requireRate } from "@/lib/ratelimit";
import { checkUpload } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  const form = await req.formData();
  const { file, mime } = checkUpload(form.get("file"));
  requireRate(aiLimiter, ctx.userId);
  const buf = Buffer.from(await file.arrayBuffer());
  const extraction = await extractDocument(buf.toString("base64"), mime);
  return Response.json({ extraction });
});
