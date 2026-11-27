import { createHash, randomBytes } from "crypto";
import { keccak256, encodePacked, toHex } from "viem";

export type Hex = `0x${string}`;

export const sha256Hex = (buf: Buffer | Uint8Array): Hex =>
  ("0x" + createHash("sha256").update(buf).digest("hex")) as Hex;

export const randomHex32 = (): Hex => toHex(randomBytes(32));
export const randomToken = () => randomBytes(24).toString("base64url");

/** Opaque, salted patient id used on-chain. Never reveals the user id. */
export const MIN_SALT_LENGTH = 32;

export function idSalt(): string {
  const salt = process.env.ID_SALT ?? "";
  if (salt.length < MIN_SALT_LENGTH) {
    throw new Error(`ID_SALT must be set to at least ${MIN_SALT_LENGTH} random characters`);
  }
  return salt;
}

export const patientChainId = (userId: string): Hex =>
  keccak256(encodePacked(["string", "string"], [idSalt(), userId]));

export const commitment = (fileSha: Hex, salt: Hex): Hex =>
  keccak256(encodePacked(["bytes32", "bytes32"], [fileSha, salt]));

export const scopeHash = (recordIds: string[]): Hex =>
  keccak256(encodePacked(["string"], [[...recordIds].sort().join(",")]));
