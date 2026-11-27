# SehatVault

AI-powered personal health records with patient-controlled sharing on **Avalanche Fuji**.
Built for BASECAMP 2026 (GDGoC GIKI) — tracks: AI & Agentic AI · Open Innovation · Digital Ownership.

Scan a prescription or report → Gemini extracts it → you confirm → it joins your timeline and its integrity
fingerprint is anchored on Avalanche. Ask **Sehat AI** to prepare a doctor visit: it searches your records,
writes a cited brief, and asks your approval to create a time-limited QR share. Any doctor can scan it (no app,
no login); every view is logged on-chain and you can revoke it anytime.

**No medical data goes on-chain** — only salted hashes, random share ids, expiry, revocation and access timestamps.

- Full build plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)
- Contract: [contracts/SehatVault.sol](contracts/SehatVault.sol) — Fuji address: `TBD`

## Stack
Next.js 15 · TypeScript · Tailwind · Supabase (Auth, Postgres, Storage) · Gemini 2.5 Flash (vision + function calling) · viem · Solidity on Avalanche Fuji

## Setup

1. **Contract** — open `contracts/SehatVault.sol` in [Remix](https://remix.ethereum.org), compile (0.8.20+),
   deploy with *Injected Provider* on Fuji (chain 43113) from a **testnet-only relayer wallet** funded from the
   [Fuji faucet](https://build.avax.network/console/primary-network/faucet). Copy the contract address.
2. **Supabase** — create a project, run `supabase/schema.sql` in the SQL editor, enable the Google auth provider
   and add your app URL (`http://localhost:3000` and the Vercel URL) to the redirect URLs.
3. **Env** — `cp .env.example .env.local` and fill in:
   Supabase URL/anon/service keys, `GEMINI_API_KEY`, `RELAYER_PRIVATE_KEY` (the deployer wallet), `CONTRACT_ADDRESS`,
   and a random `ID_SALT` (32+ chars). Never commit `.env.local`.
4. **Run** — `npm install` then `npm run dev` and open http://localhost:3000.
5. **Deploy** — import the repo in Vercel and add the same env vars (+ `NEXT_PUBLIC_APP_URL` = your Vercel URL).

## How it works
| Piece | Where |
|---|---|
| Document extraction (Gemini vision, uncertainty flags) | `src/lib/gemini.ts`, `src/app/api/extract` |
| Save + anchor commitment on Fuji | `src/app/api/records` |
| Agent loop + tools (search, meds, labs, brief, approval, verify) | `src/lib/agent.ts`, `src/lib/tools.ts` |
| Share create / revoke (on-chain permission) | `src/app/api/share` |
| Public doctor view + on-chain access log | `src/app/s/[token]`, `src/app/api/s/[token]` |
| Integrity verification | `src/lib/records.ts`, `src/app/api/verify` |

The AI never shares anything by itself: creating and revoking shares only happens from the patient's
Approve / Revoke buttons.

## Prototype limitations
- A server relayer signs Fuji transactions for patients (production: embedded patient wallets).
- Files are in a private Supabase bucket served via short-lived signed links (production: app-level encryption).
- Anyone holding a share link can view it until it expires or is revoked (production: PIN / recipient auth).
- Not medical advice; extracted data must be confirmed by the patient. Use synthetic data only.
