import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "./hash";

const abi = parseAbi([
  "function registerRecord(bytes32 patient, bytes32 commitment)",
  "function verifyRecord(bytes32 patient, bytes32 commitment) view returns (bool)",
  "function createShare(bytes32 shareId, bytes32 patient, bytes32 scope, uint64 expiresAt)",
  "function revokeShare(bytes32 shareId, bytes32 patient)",
  "function isShareActive(bytes32 shareId) view returns (bool)",
  "function logAccess(bytes32 shareId)",
]);

function makeClients() {
  if (!process.env.RELAYER_PRIVATE_KEY || !process.env.CONTRACT_ADDRESS) {
    throw new Error("Blockchain not configured (RELAYER_PRIVATE_KEY / CONTRACT_ADDRESS)");
  }
  const transport = http(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc");
  const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);
  return {
    address: process.env.CONTRACT_ADDRESS as Hex,
    pub: createPublicClient({ chain: avalancheFuji, transport }),
    wallet: createWalletClient({ chain: avalancheFuji, transport, account }),
  };
}

// Created lazily so `next build` works without secrets.
let clients: ReturnType<typeof makeClients> | null = null;
const c = () => (clients ??= makeClients());

async function wait(hash: Hex) {
  await c().pub.waitForTransactionReceipt({ hash });
  return hash;
}

export const chain = {
  registerRecord: async (patient: Hex, commitment: Hex) =>
    wait(await c().wallet.writeContract({ address: c().address, abi, functionName: "registerRecord", args: [patient, commitment] })),
  createShare: async (id: Hex, patient: Hex, scope: Hex, expiresAt: bigint) =>
    wait(await c().wallet.writeContract({ address: c().address, abi, functionName: "createShare", args: [id, patient, scope, expiresAt] })),
  revokeShare: async (id: Hex, patient: Hex) =>
    wait(await c().wallet.writeContract({ address: c().address, abi, functionName: "revokeShare", args: [id, patient] })),
  /** Sends without waiting for the receipt so the doctor page stays fast. */
  logAccess: (id: Hex) =>
    c().wallet.writeContract({ address: c().address, abi, functionName: "logAccess", args: [id] }),
  isShareActive: (id: Hex) =>
    c().pub.readContract({ address: c().address, abi, functionName: "isShareActive", args: [id] }),
  verifyRecord: (patient: Hex, commitment: Hex) =>
    c().pub.readContract({ address: c().address, abi, functionName: "verifyRecord", args: [patient, commitment] }),
};

export const explorerTx = (h?: string | null) => (h ? `https://testnet.snowtrace.io/tx/${h}` : null);
export const explorerAddress = () =>
  process.env.CONTRACT_ADDRESS ? `https://testnet.snowtrace.io/address/${process.env.CONTRACT_ADDRESS}` : null;
