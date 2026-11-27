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

Needs Node 20.6+.

1. **Install** — `npm install`.
2. **Env** — `cp .env.example .env.local` and fill in the Supabase URL/anon/service keys, `GEMINI_API_KEY`,
   `RELAYER_PRIVATE_KEY` (a **new, testnet-only** wallet funded from the
   [Fuji faucet](https://build.avax.network/console/primary-network/faucet)) and a random `ID_SALT` of 32+ characters
   (`openssl rand -hex 32`). The app refuses to run with a missing or short salt. Never commit `.env.local`.
3. **Contract** — `npm run contract:compile` to check it builds, then `npm run contract:deploy`. The script checks
   it is on Fuji and the wallet has gas, deploys, prints the address and writes `deployments/fuji.json`.
   Put the address in `CONTRACT_ADDRESS`. (Remix with *Injected Provider* on chain 43113 also works.)
4. **Supabase** — create a project, run `supabase/schema.sql` in the SQL editor (it creates the private `records`
   bucket), enable the Google auth provider and add `http://localhost:3000` and the Vercel URL to the redirect URLs.
   If you ran an older copy of the schema, also run the `alter table` lines in its comments.
5. **Run** — `npm run dev` and open http://localhost:3000.
6. **Demo data** — sign in once with the demo Google account, then
   `npm run seed -- --email <that account>` loads 14 fictional records (2022–2026) and anchors each on Fuji.
   Add `--reset` to replace existing data, `--no-anchor` to skip transactions. Keep the unclear handwritten
   prescription for the live upload.
7. **Deploy** — import the repo in Vercel and add the same env vars (+ `NEXT_PUBLIC_APP_URL` = your Vercel URL).

## Testing
`npm test` runs 97 unit and API-route tests (Supabase, Gemini and the chain are faked);
`npm run test:coverage` adds a coverage report (≈95% of lines in `src/lib` and `src/app/api`).
`npm run typecheck`, `npm run lint` and `npm run build` should all pass before deploying.

## Safeguards
- **Relayer gas** — the doctor view sends at most one paid `logAccess` per share every 10 minutes, claimed with an
  atomic database update so parallel views can't both pay (other views are logged in the database only), and is
  rate-limited per IP; record and share transactions and Gemini calls are rate-limited per user; relayer sends are
  queued so they don't collide on nonces.
- **Fail closed** — a share link opens only if both the database and the contract say it is active; if Avalanche
  can't be reached the doctor sees "try again", never the records.
- **No half-saved state** — shares are stored as `pending` until the contract confirms them and are removed if the
  transaction fails; a record whose medicines or tests fail to save is rolled back with its file; re-anchoring is
  safe to retry.
- **Revoke always works** — it closes the link in the database first (checked before the contract), then revokes
  on-chain; if the relayer is out of gas or Avalanche is down, the patient can record it on-chain later from the
  Share tab. Doctor-view document links expire after 60 seconds.
- **Input checks** — uploads must be JPG/PNG/WebP/HEIC/PDF under 4 MB (large photos are shrunk in the browser
  first, as Vercel caps request bodies at 4.5 MB); confirmed records, ids and share tokens are validated with zod.
- **No leaked internals** — database, RPC and Gemini errors are logged on the server and shown as a generic message;
  `Referrer-Policy: no-referrer` keeps share tokens out of other sites' logs.

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
- Rate limits are kept in server memory, so they are per Vercel instance (production: Redis / Upstash).
- Large photos are re-encoded before upload, so "Verify a copy" matches the stored version (download it with
  "Open original"), not the untouched photo from the phone.
- Not medical advice; extracted data must be confirmed by the patient. Use synthetic data only.
