/**
 * Minimal in-memory stand-in for the Supabase client used by the API routes.
 * Each query records its operations; a per-table handler decides the result.
 */
export type Op = { name: string; args: unknown[] };
export type Query = { table: string; ops: Op[]; has: (name: string) => boolean; arg: (name: string, i?: number) => unknown };
export type Result = { data?: unknown; error?: { message: string } | null; count?: number };
export type Handler = (q: Query) => Result;

const CHAIN_METHODS = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "not", "gte", "lte", "or", "order", "limit"];

export function fakeSupabase(handlers: Record<string, Handler>, user: { id: string; email?: string } | null = { id: "11111111-1111-4111-8111-111111111111" }) {
  const queries: Query[] = [];
  const storageCalls: Op[] = [];

  const run = (q: Query): Result => {
    const h = handlers[q.table];
    const r = h ? h(q) : { data: null };
    return { data: r.data ?? null, error: r.error ?? null, count: r.count };
  };

  const from = (table: string) => {
    const ops: Op[] = [];
    const q: Query = {
      table,
      ops,
      has: (name) => ops.some((o) => o.name === name),
      arg: (name, i = 0) => ops.find((o) => o.name === name)?.args[i],
    };
    queries.push(q);
    const builder: Record<string, unknown> = {};
    for (const m of CHAIN_METHODS) {
      builder[m] = (...args: unknown[]) => {
        ops.push({ name: m, args });
        return builder;
      };
    }
    builder.maybeSingle = async () => run(q);
    builder.single = async () => run(q);
    builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run(q)).then(resolve, reject);
    return builder;
  };

  const storage = {
    from: () => ({
      upload: async (...args: unknown[]) => (storageCalls.push({ name: "upload", args }), { data: {}, error: null }),
      remove: async (...args: unknown[]) => (storageCalls.push({ name: "remove", args }), { data: {}, error: null }),
      createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://files.test/${path}?sig=1` }, error: null }),
      download: async () => ({ data: new Blob(["file"]), error: null }),
    }),
  };

  const auth = {
    getUser: async () => (user ? { data: { user: { ...user, user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: "bad" } }),
  };

  return { client: { from, storage, auth }, queries, storageCalls, ofTable: (t: string) => queries.filter((q) => q.table === t) };
}
