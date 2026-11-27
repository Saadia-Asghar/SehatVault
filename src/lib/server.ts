import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { patientChainId, type Hex } from "./hash";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const admin = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export type Ctx = { db: SupabaseClient; userId: string; patientId: Hex };

/** Validates the Supabase access token sent in the Authorization header. */
export async function requireUser(req: Request): Promise<Ctx> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session expired, please sign in again");
  const user = data.user;
  const patientId = patientChainId(user.id);
  await db.from("profiles").upsert(
    {
      user_id: user.id,
      display_name: (user.user_metadata?.full_name as string | undefined) ?? user.email,
      patient_chain_id: patientId,
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  return { db, userId: user.id, patientId };
}

export function handle<C = { params: Promise<Record<string, string>> }>(
  fn: (req: Request, ctx: C) => Promise<Response>,
) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : "Unexpected error";
      if (status === 500) console.error(e);
      return Response.json({ error: message }, { status });
    }
  };
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
