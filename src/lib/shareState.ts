export type ShareStatus = "pending" | "active" | "revoked";
export type ShareState = "active" | "expired" | "revoked" | "invalid";

/** Only one paid on-chain access event per share in this window; other views are logged in the database only. */
export const ACCESS_ANCHOR_WINDOW_MS = 10 * 60_000;

/** Decides a share's state from the database row alone (the contract is checked separately). */
export function shareStateFromDb(status: string, expiresAt: string, now: number = Date.now()): ShareState {
  if (status === "revoked") return "revoked";
  if (status !== "active") return "invalid"; // pending: the on-chain permission was never confirmed
  const expiry = new Date(expiresAt).getTime();
  if (Number.isNaN(expiry) || expiry < now) return "expired";
  return "active";
}

export const anchorWindowStart = (now: number = Date.now()): string =>
  new Date(now - ACCESS_ANCHOR_WINDOW_MS).toISOString();
