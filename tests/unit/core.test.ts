import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERIC_ERROR, HttpError, errorMessage, toErrorResponse } from "@/lib/errors";
import { createRateLimiter, clientIp, requireRate } from "@/lib/ratelimit";
import { ACCESS_ANCHOR_WINDOW_MS, anchorWindowStart, shareStateFromDb } from "@/lib/shareState";
import { commitment, idSalt, patientChainId, randomHex32, randomToken, scopeHash, sha256Hex } from "@/lib/hash";

describe("toErrorResponse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows 4xx HttpError messages to the user", async () => {
    const res = toErrorResponse(new HttpError(403, "Some records are not yours"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Some records are not yours" });
  });

  it("hides internal details of 500 errors and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = toErrorResponse(new HttpError(500, 'relation "medical_records" violates constraint'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR });
    expect(log).toHaveBeenCalled();
  });

  it("hides unexpected errors such as RPC failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = toErrorResponse(new Error("HTTP request failed. URL: https://api.avax-test.network"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: GENERIC_ERROR });
  });

  it("keeps deliberate 502/503 messages visible", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = toErrorResponse(new HttpError(502, "Could not register the permission on Avalanche."));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Avalanche");
  });

  it("turns malformed JSON bodies into 400", async () => {
    const res = toErrorResponse(new SyntaxError("Unexpected token"));
    expect(res.status).toBe(400);
  });

  it("errorMessage handles non-Error values", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit then blocks within the window", () => {
    const limiter = createRateLimiter(2, 1000, () => 0);
    expect([limiter.check("a"), limiter.check("a"), limiter.check("a")]).toEqual([true, true, false]);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter(1, 1000, () => 0);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("resets after the window passes", () => {
    let t = 0;
    const limiter = createRateLimiter(1, 1000, () => t);
    limiter.check("a");
    expect(limiter.check("a")).toBe(false);
    t = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  it("requireRate throws 429 when exhausted", () => {
    const limiter = createRateLimiter(1, 1000);
    requireRate(limiter, "u");
    expect(() => requireRate(limiter, "u")).toThrowError(expect.objectContaining({ status: 429 }));
  });

  it("clientIp reads the first forwarded address", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});

describe("shareStateFromDb", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");

  it("treats revoked as revoked regardless of expiry", () => {
    expect(shareStateFromDb("revoked", "2030-01-01T00:00:00Z", now)).toBe("revoked");
  });

  it("treats pending (never confirmed on-chain) as invalid", () => {
    expect(shareStateFromDb("pending", "2030-01-01T00:00:00Z", now)).toBe("invalid");
  });

  it("detects expiry", () => {
    expect(shareStateFromDb("active", "2026-11-27T11:59:59Z", now)).toBe("expired");
    expect(shareStateFromDb("active", "not-a-date", now)).toBe("expired");
  });

  it("is active before expiry", () => {
    expect(shareStateFromDb("active", "2026-11-28T00:00:00Z", now)).toBe("active");
  });

  it("anchorWindowStart is one window before now", () => {
    expect(Date.parse(anchorWindowStart(now))).toBe(now - ACCESS_ANCHOR_WINDOW_MS);
  });
});

describe("hash helpers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("patientChainId is stable per user and differs between users", () => {
    expect(patientChainId("u1")).toBe(patientChainId("u1"));
    expect(patientChainId("u1")).not.toBe(patientChainId("u2"));
  });

  it("refuses a missing or short ID_SALT", () => {
    vi.stubEnv("ID_SALT", "short");
    expect(() => idSalt()).toThrow(/ID_SALT/);
    expect(() => patientChainId("u1")).toThrow(/ID_SALT/);
  });

  it("commitment changes when the file or salt changes", () => {
    const a = sha256Hex(Buffer.from("report v1"));
    const b = sha256Hex(Buffer.from("report v2"));
    const salt = randomHex32();
    expect(commitment(a, salt)).toBe(commitment(a, salt));
    expect(commitment(a, salt)).not.toBe(commitment(b, salt));
    expect(commitment(a, salt)).not.toBe(commitment(a, randomHex32()));
  });

  it("scopeHash ignores record order", () => {
    expect(scopeHash(["b", "a"])).toBe(scopeHash(["a", "b"]));
  });

  it("randomToken has the 32-char base64url shape the doctor view expects", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
