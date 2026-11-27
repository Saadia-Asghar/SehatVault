import { z } from "zod";
import { handle, requireUser, HttpError } from "@/lib/server";
import { runAgent } from "@/lib/agent";
import { aiLimiter, requireRate } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(8000) }))
    .max(40)
    .default([]),
});

export const POST = handle(async (req) => {
  const ctx = await requireUser(req);
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  requireRate(aiLimiter, ctx.userId);
  const result = await runAgent(ctx, parsed.data.message, parsed.data.history);
  return Response.json(result);
});
