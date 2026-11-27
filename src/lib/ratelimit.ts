import { HttpError } from "./errors";

type Bucket = { count: number; resetAt: number };
const MAX_BUCKETS = 10_000;

/**
 * Fixed-window in-memory limiter. Per server instance only, which is enough to stop
 * a single client from draining the relayer wallet or the Gemini quota in a prototype.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  let buckets = new Map<string, Bucket>();

  const prune = (t: number) => {
    buckets = new Map([...buckets].filter(([, b]) => b.resetAt > t));
  };

  return {
    /** Returns true if the call is allowed and counts it. */
    check(key: string): boolean {
      const t = now();
      const b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        if (buckets.size >= MAX_BUCKETS) prune(t);
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      if (b.count >= limit) return false;
      buckets.set(key, { count: b.count + 1, resetAt: b.resetAt });
      return true;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

const MINUTE = 60_000;

/** Public doctor-view requests, per IP. */
export const publicViewLimiter = createRateLimiter(30, MINUTE);
/** Transactions the relayer pays for (record anchoring, shares, revokes), per user. */
export const chainWriteLimiter = createRateLimiter(30, 10 * MINUTE);
/** Gemini calls (extraction and agent), per user. */
export const aiLimiter = createRateLimiter(40, 10 * MINUTE);

export function requireRate(limiter: RateLimiter, key: string) {
  if (!limiter.check(key)) throw new HttpError(429, "Too many requests. Please wait a few minutes and try again.");
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
