/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Turns any thrown value into a JSON response. HttpError messages are shown to the user, except
 * status 500, which carries internal details (database, RPC, Gemini): those and any unexpected
 * errors are logged server-side and replaced by a generic message.
 */
export function toErrorResponse(e: unknown): Response {
  if (e instanceof SyntaxError) return Response.json({ error: "Invalid request body" }, { status: 400 });
  if (e instanceof HttpError && e.status !== 500) {
    if (e.status > 500) console.error(e);
    return Response.json({ error: e.message }, { status: e.status });
  }
  console.error(e);
  return Response.json({ error: GENERIC_ERROR }, { status: 500 });
}
