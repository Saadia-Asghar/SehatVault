import { z } from "zod";
import { handle, requireUser, HttpError } from "@/lib/server";
import { verifyRecordFile } from "@/lib/records";
import { checkUpload, parseId } from "@/lib/validate";

export const runtime = "nodejs";

const Body = z.object({ record_id: z.string() });

/** JSON {record_id} checks the stored file; multipart {record_id, file} checks an uploaded copy. */
export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const id = form.get("record_id");
    const { file } = checkUpload(form.get("file"));
    const recordId = parseId(typeof id === "string" ? id : null);
    return Response.json(await verifyRecordFile(ctx, recordId, Buffer.from(await file.arrayBuffer())));
  }
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "record_id required");
  return Response.json(await verifyRecordFile(ctx, parseId(parsed.data.record_id)));
});
