/**
 * Compiles contracts/SehatVault.sol and deploys it to Avalanche Fuji from the relayer wallet.
 *
 *   npm run contract:compile          # compile only, no keys needed
 *   npm run contract:deploy           # needs RELAYER_PRIVATE_KEY in .env.local
 *
 * Writes deployments/fuji.json and the standard-JSON input used for explorer verification.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import solc from "solc";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

const SOURCE_PATH = "contracts/SehatVault.sol";
const CONTRACT = "SehatVault";
/** Avalanche C-Chain supports Shanghai opcodes (PUSH0) since Durango. */
const EVM_VERSION = "shanghai";
const MIN_BALANCE_WEI = parseEther("0.05");

type SolcOutput = {
  errors?: { severity: string; formattedMessage: string }[];
  contracts: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>;
};

function compile() {
  const input = {
    language: "Solidity",
    sources: { [SOURCE_PATH]: { content: readFileSync(SOURCE_PATH, "utf8") } },
    settings: {
      evmVersion: EVM_VERSION,
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  for (const w of out.errors ?? []) console.warn(w.formattedMessage);
  const artifact = out.contracts[SOURCE_PATH][CONTRACT];
  return { input, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` as Hex };
}

async function deploy(abi: Abi, bytecode: Hex) {
  const key = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("Set RELAYER_PRIVATE_KEY in .env.local (a testnet-only wallet)");
  const transport = http(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc");
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: avalancheFuji, transport });
  const wallet = createWalletClient({ chain: avalancheFuji, transport, account });

  const chainId = await pub.getChainId();
  if (chainId !== avalancheFuji.id) throw new Error(`RPC is on chain ${chainId}, expected Fuji (${avalancheFuji.id})`);
  const balance = await pub.getBalance({ address: account.address });
  console.log(`Relayer ${account.address} has ${formatEther(balance)} AVAX`);
  if (balance < MIN_BALANCE_WEI) throw new Error("Fund the relayer from the Fuji faucet first (at least 0.05 AVAX)");

  const hash = await wallet.deployContract({ abi, bytecode });
  console.log(`Deploy tx ${hash} — waiting for confirmation…`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("Deployment failed: no contract address in receipt");
  return { address: receipt.contractAddress, hash, relayer: account.address };
}

async function main() {
  const { input, abi, bytecode } = compile();
  console.log(`Compiled ${CONTRACT} (${(bytecode.length - 2) / 2} bytes, solc ${solc.version()})`);
  if (process.argv.includes("--compile-only")) return;

  const result = await deploy(abi, bytecode);
  mkdirSync("deployments", { recursive: true });
  writeFileSync(
    "deployments/fuji.json",
    JSON.stringify({ ...result, chainId: avalancheFuji.id, compiler: solc.version(), deployedAt: new Date().toISOString() }, null, 2),
  );
  writeFileSync("deployments/SehatVault.standard-input.json", JSON.stringify(input, null, 2));
  console.log(`\nDeployed at ${result.address}`);
  console.log(`Explorer: https://testnet.snowtrace.io/address/${result.address}`);
  console.log(`\nAdd to .env.local and Vercel:\nCONTRACT_ADDRESS=${result.address}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
