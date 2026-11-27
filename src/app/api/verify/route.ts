import { handle, requireUser, HttpError } from "@/lib/server";
import { verifyRecordFile } from "@/lib/records";

export const runtime = "nodejs";

/** JSON {record_id} checks the stored file; multipart {record_id, file} checks an uploaded copy. */
export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const id = form.get("record_id");
    const file = form.get("file");
    if (typeof id !== "string" || !(file instanceof File)) throw new HttpError(400, "record_id and file required");
    return Response.json(await verifyRecordFile(ctx, id, Buffer.from(await file.arrayBuffer())));
  }
  const body = (await req.json()) as { record_id?: string };
  if (!body.record_id) throw new HttpError(400, "record_id required");
  return Response.json(await verifyRecordFile(ctx, body.record_id));
});
