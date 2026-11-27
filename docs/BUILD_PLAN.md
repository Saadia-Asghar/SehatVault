# SehatVault — Full Build Plan (BASECAMP 2026)

> AI agent that turns scattered prescriptions and reports into a medical timeline, prepares you for a doctor visit, and shares the right records through a time-limited QR — with integrity and permissions anchored on Avalanche Fuji.

**Real time budget:** kickoff Fri 6 PM → presentations Sat 10 AM. Assume coding 8 PM → 9:30 AM (~13.5 h).
**Rule #1:** the 7-step demo flow must work end to end. Everything else is optional.

```
1 Scan doc → 2 AI extract + confirm → 3 Timeline → 4 Agent "prepare for cardiologist"
→ 5 Approve share + QR → 6 Judge scans on phone (access logged on Fuji) → 7 Revoke + verify on explorer
```

---

## 0. Before kickoff (no coding — check whether pre-written code is allowed)

| Item | Owner | Done |
|---|---|---|
| Ask organizers: is pre-written code allowed? multiple tracks? submission format? | Lead | ☐ |
| Gemini API key (Google AI Studio) — use Antigravity credits if offered | AI dev | ☐ |
| Supabase project created (free tier), Google OAuth provider enabled | Backend | ☐ |
| Vercel account linked to GitHub | Frontend | ☐ |
| Core Wallet / MetaMask with **Fuji** network; new **relayer wallet** (never a personal wallet) | Chain dev | ☐ |
| Fuji AVAX from faucet into relayer wallet (≥ 2 AVAX) | Chain dev | ☐ |
| 15 synthetic documents (see §9) — print + photograph, incl. 1 handwritten, 1 unclear | Pitch | ☐ |
| Install: Node 20+, npm, Git | All | ☐ |
| Phone hotspot charged | All | ☐ |

---

## 1. Architecture (hackathon version)

```
 Patient phone (Next.js PWA on Vercel)
   │ Google login (Supabase Auth)
   ▼
 Next.js API routes (server)  ──────────────►  Gemini 2.5 Flash
   │   /api/extract  /api/records  /api/agent        (vision + function calling)
   │   /api/share    /api/share/[id]/revoke
   │   /api/s/[token] (doctor view)  /api/verify
   │
   ├──► Supabase Postgres (records, shares, logs)  +  private Storage bucket (files)
   │
   └──► viem + RELAYER wallet ──► SehatVault.sol on Avalanche Fuji (chain 43113)
                                   registerRecord / createShare / revokeShare / logAccess
 Doctor phone: opens /s/<token>  → server checks token + contract → read-only records
```

**Key simplification:** a server-side **relayer wallet** signs every Fuji transaction on the patient's behalf. Patients never touch crypto. Say on stage: *"Prototype uses a relayer; production uses embedded patient wallets."*

**Privacy rule:** on-chain = only opaque IDs, salted hashes, expiry, revoked flag, access timestamps. Never names, medicines, diagnoses, links.

---

## 2. Repo layout

```
sehatvault/
├─ contracts/SehatVault.sol
├─ supabase/schema.sql
├─ src/
│  ├─ app/
│  │  ├─ page.tsx             # landing + login
│  │  ├─ dashboard/page.tsx
│  │  ├─ upload/page.tsx      # scan + confirm
│  │  ├─ timeline/page.tsx
│  │  ├─ agent/page.tsx       # chat + tool-step trace
│  │  ├─ share/page.tsx       # active shares, revoke
│  │  ├─ privacy/page.tsx     # on-chain proofs, verify
│  │  ├─ s/[token]/page.tsx   # DOCTOR VIEW (public, no login)
│  │  └─ api/
│  │     ├─ extract/route.ts
│  │     ├─ records/route.ts
│  │     ├─ agent/route.ts
│  │     ├─ share/route.ts
│  │     ├─ share/[id]/revoke/route.ts
│  │     ├─ s/[token]/route.ts
│  │     └─ verify/route.ts
│  ├─ lib/
│  │  ├─ supabase.ts          # server + browser clients
│  │  ├─ chain.ts             # viem clients + contract calls
│  │  ├─ hash.ts              # sha256 / commitments / ids
│  │  ├─ gemini.ts            # extraction + agent
│  │  └─ tools.ts             # agent tool implementations
│  └─ components/             # Timeline, RecordCard, AgentTrace, QRCard...
├─ .env.local                 # NEVER commit
└─ README.md
```

### Setup commands

```bash
npx create-next-app@latest sehatvault --ts --tailwind --app --src-dir --eslint
cd sehatvault
npm i @supabase/supabase-js @supabase/ssr @google/genai viem qrcode zod
npm i -D @types/qrcode
npx shadcn@latest init
npx shadcn@latest add button card input textarea badge dialog tabs sonner
```

### `.env.local`

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only
GEMINI_API_KEY=                     # server only
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
RELAYER_PRIVATE_KEY=                # testnet-only wallet, server only
CONTRACT_ADDRESS=
ID_SALT=                            # random 32+ chars, derives opaque patient IDs
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 3. Smart contract (deploy in hour 1)

`contracts/SehatVault.sol` — deploy with **Remix** (Injected Provider → relayer wallet on Fuji). Then verify on the Fuji explorer.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SehatVault — integrity commitments + revocable share permissions.
/// Stores only opaque IDs and salted hashes. No medical data on-chain.
contract SehatVault {
    address public owner;
    mapping(address => bool) public relayers;

    struct Share {
        bytes32 patient;      // opaque patient id (keccak of salted user id)
        bytes32 scope;        // hash of the shared record-id list
        uint64  expiresAt;
        bool    revoked;
    }

    // patient => commitment => registered
    mapping(bytes32 => mapping(bytes32 => bool)) private records;
    mapping(bytes32 => Share) public shares;

    event RecordRegistered(bytes32 indexed patient, bytes32 commitment);
    event ShareCreated(bytes32 indexed shareId, bytes32 indexed patient, uint64 expiresAt);
    event ShareRevoked(bytes32 indexed shareId);
    event ShareAccessed(bytes32 indexed shareId, uint64 at);
    event RelayerSet(address relayer, bool allowed);

    modifier onlyOwner()   { require(msg.sender == owner, "not owner"); _; }
    modifier onlyRelayer() { require(relayers[msg.sender], "not relayer"); _; }

    constructor() {
        owner = msg.sender;
        relayers[msg.sender] = true;
        emit RelayerSet(msg.sender, true);
    }

    function setRelayer(address r, bool allowed) external onlyOwner {
        relayers[r] = allowed;
        emit RelayerSet(r, allowed);
    }

    function registerRecord(bytes32 patient, bytes32 commitment) external onlyRelayer {
        require(commitment != bytes32(0), "empty");
        require(!records[patient][commitment], "duplicate");
        records[patient][commitment] = true;
        emit RecordRegistered(patient, commitment);
    }

    function verifyRecord(bytes32 patient, bytes32 commitment) external view returns (bool) {
        return records[patient][commitment];
    }

    function createShare(bytes32 shareId, bytes32 patient, bytes32 scope, uint64 expiresAt)
        external onlyRelayer
    {
        require(shares[shareId].expiresAt == 0, "share exists");
        require(expiresAt > block.timestamp, "bad expiry");
        shares[shareId] = Share(patient, scope, expiresAt, false);
        emit ShareCreated(shareId, patient, expiresAt);
    }

    function revokeShare(bytes32 shareId, bytes32 patient) external onlyRelayer {
        Share storage s = shares[shareId];
        require(s.expiresAt != 0, "no share");
        require(s.patient == patient, "not patient's share");
        require(!s.revoked, "already revoked");
        s.revoked = true;
        emit ShareRevoked(shareId);
    }

    function isShareActive(bytes32 shareId) public view returns (bool) {
        Share memory s = shares[shareId];
        return s.expiresAt != 0 && !s.revoked && block.timestamp <= s.expiresAt;
    }

    function logAccess(bytes32 shareId) external onlyRelayer {
        require(isShareActive(shareId), "inactive");
        emit ShareAccessed(shareId, uint64(block.timestamp));
    }
}
```

**Remix test before wiring the app:** registerRecord → verifyRecord (true) → createShare (expiry = now+600) → isShareActive (true) → logAccess → revokeShare → isShareActive (false) → logAccess reverts. Save contract address + deploy tx hash in README.

---

## 4. Database (`supabase/schema.sql`)

```sql
create table profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text,
  patient_chain_id text not null,          -- 0x… opaque bytes32
  created_at timestamptz default now()
);

create table medical_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  doc_type text,                           -- prescription | lab_report | discharge | consultation | other
  doc_date date,
  doctor text,
  facility text,
  summary text,
  extracted jsonb,                         -- full confirmed extraction
  uncertain_fields text[] default '{}',
  file_path text not null,                 -- private bucket path
  file_sha256 text not null,
  record_salt text not null,
  commitment text not null,                -- keccak(fileSha256, salt)
  tx_hash text,
  status text default 'confirmed',
  created_at timestamptz default now()
);

create table medications (
  id uuid primary key default gen_random_uuid(),
  record_id uuid references medical_records on delete cascade,
  user_id uuid not null,
  name text, dose text, frequency text, duration text, uncertain boolean default false
);

create table lab_results (
  id uuid primary key default gen_random_uuid(),
  record_id uuid references medical_records on delete cascade,
  user_id uuid not null,
  test_name text, value numeric, unit text, ref_range text, result_date date
);

create table share_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  share_chain_id text not null unique,     -- bytes32 on-chain id
  token_hash text not null unique,         -- sha256(secret token); secret only in QR
  brief text,                              -- visit brief shown to doctor
  expires_at timestamptz not null,
  status text default 'active',
  tx_hash text, revoke_tx_hash text,
  created_at timestamptz default now()
);

create table share_records (
  share_id uuid references share_permissions on delete cascade,
  record_id uuid references medical_records on delete cascade,
  primary key (share_id, record_id)
);

create table access_logs (
  id bigserial primary key,
  share_id uuid references share_permissions on delete cascade,
  accessed_at timestamptz default now(),
  result text,                              -- granted | expired | revoked | invalid
  tx_hash text
);

-- RLS: owners read/write own rows. Doctor view goes through server routes with service role.
alter table profiles enable row level security;
alter table medical_records enable row level security;
alter table medications enable row level security;
alter table lab_results enable row level security;
alter table share_permissions enable row level security;
alter table share_records enable row level security;
alter table access_logs enable row level security;

create policy own_profiles on profiles for all using (auth.uid() = user_id);
create policy own_records on medical_records for all using (auth.uid() = user_id);
create policy own_meds on medications for all using (auth.uid() = user_id);
create policy own_labs on lab_results for all using (auth.uid() = user_id);
create policy own_shares on share_permissions for all using (auth.uid() = user_id);
```

Storage: create **private** bucket `records`. Files at `records/{user_id}/{uuid}.{ext}`. Serve only through short-lived signed URLs (60 s).

---

## 5. Core library code

### `lib/hash.ts`

```ts
import { createHash, randomBytes } from "crypto";
import { keccak256, encodePacked, toHex } from "viem";

export const sha256Hex = (buf: Buffer) =>
  ("0x" + createHash("sha256").update(buf).digest("hex")) as `0x${string}`;
export const randomHex32 = () => toHex(randomBytes(32));
export const randomToken = () => randomBytes(24).toString("base64url");

export const patientChainId = (userId: string) =>
  keccak256(encodePacked(["string", "string"], [process.env.ID_SALT!, userId]));

export const commitment = (fileSha: `0x${string}`, salt: `0x${string}`) =>
  keccak256(encodePacked(["bytes32", "bytes32"], [fileSha, salt]));

export const scopeHash = (recordIds: string[]) =>
  keccak256(encodePacked(["string"], [[...recordIds].sort().join(",")]));
```

### `lib/chain.ts`

```ts
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const abi = parseAbi([
  "function registerRecord(bytes32 patient, bytes32 commitment)",
  "function verifyRecord(bytes32 patient, bytes32 commitment) view returns (bool)",
  "function createShare(bytes32 shareId, bytes32 patient, bytes32 scope, uint64 expiresAt)",
  "function revokeShare(bytes32 shareId, bytes32 patient)",
  "function isShareActive(bytes32 shareId) view returns (bool)",
  "function logAccess(bytes32 shareId)",
]);
type Hex = `0x${string}`;
const address = process.env.CONTRACT_ADDRESS as Hex;
const transport = http(process.env.FUJI_RPC_URL);
const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex);

export const pub = createPublicClient({ chain: avalancheFuji, transport });
const wallet = createWalletClient({ chain: avalancheFuji, transport, account });

async function send(functionName: any, args: readonly unknown[], wait = true) {
  const hash = await wallet.writeContract({ address, abi, functionName, args } as any);
  if (wait) await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export const chain = {
  registerRecord: (p: Hex, c: Hex) => send("registerRecord", [p, c]),
  createShare: (id: Hex, p: Hex, scope: Hex, exp: bigint) => send("createShare", [id, p, scope, exp]),
  revokeShare: (id: Hex, p: Hex) => send("revokeShare", [id, p]),
  logAccess: (id: Hex) => send("logAccess", [id], false),      // don't block doctor page
  isShareActive: (id: Hex) =>
    pub.readContract({ address, abi, functionName: "isShareActive", args: [id] }),
  verifyRecord: (p: Hex, c: Hex) =>
    pub.readContract({ address, abi, functionName: "verifyRecord", args: [p, c] }),
};
export const explorerTx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;
```

---

## 6. AI layer

### 6a. Extraction — `POST /api/extract`

Input: file (image/PDF). Output: JSON for the confirm screen (nothing saved yet). Model: `gemini-2.5-flash` (fast, vision, structured output).

**System prompt**

```
You extract information from a single medical document image or PDF.
Rules:
- Copy values exactly as written. Never guess. Never add medical advice.
- If a field is unreadable or ambiguous, set it to null and add its name to "uncertain_fields".
- Medicine names you are not certain about: keep your best reading but set "uncertain": true.
- Dates: ISO format YYYY-MM-DD if readable, else null.
Return only JSON matching the schema.
```

**Response shape** (pass as `responseSchema` with `responseMimeType: "application/json"`)

```json
{
  "doc_type": "prescription|lab_report|discharge|consultation|other",
  "doc_date": "string|null",
  "doctor": "string|null",
  "facility": "string|null",
  "complaint_or_reason": "string|null",
  "diagnosis_as_written": "string|null",
  "medications": [{ "name": "string", "dose": "string|null", "frequency": "string|null",
                    "duration": "string|null", "uncertain": "boolean" }],
  "lab_results": [{ "test_name": "string", "value": "number|null", "unit": "string|null",
                    "ref_range": "string|null" }],
  "follow_up": "string|null",
  "summary": "one plain sentence describing the document",
  "uncertain_fields": ["string"]
}
```

```ts
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const res = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [
    { inlineData: { mimeType: file.type, data: base64 } },
    { text: "Extract this medical document." },
  ]}],
  config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseSchema: SCHEMA },
});
const data = JSON.parse(res.text!);
```

### 6b. Save — `POST /api/records`

1. Upload file to private bucket.
2. `fileSha = sha256Hex(buffer)`, `salt = randomHex32()`, `c = commitment(fileSha, salt)`.
3. Insert `medical_records` + `medications` + `lab_results` from the **confirmed** form values.
4. `tx = chain.registerRecord(patientChainId(user.id), c)` → store `tx_hash`.
5. Return record + explorer link. If the tx fails, keep the record with `tx_hash = null` and show "Retry anchoring" — never lose user data.

### 6c. Agent — `POST /api/agent`

One orchestrating agent, Gemini function calling, loop max 6 steps. Stream each tool call to the UI as a step (`AgentTrace` component) — judges must *see* the actions.

**System prompt**

```
You are Sehat AI, a medical RECORDS assistant for one patient.
- Answer ONLY from tool results about this patient's own records. Cite record ids for every fact.
- If information is not in the records, say: "I couldn't find that in your uploaded records."
- Never diagnose, never recommend medicines or dose changes. You may say "discuss this with your doctor."
- For visit preparation: search relevant records, compare labs if present, generate a brief,
  propose records to share, then call request_approval. Never create a share without approval.
- Keep answers short. If the user writes Urdu/Roman Urdu, reply in the same.
```

**Tools**

| Tool | Params | Implementation (server, always scoped to the logged-in user) |
|---|---|---|
| `search_records` | `query`, `doc_type?`, `from?`, `to?`, `specialty_hint?` | SQL `ilike` over summary/doctor/facility/diagnosis + medications; return ≤10 compact rows with ids |
| `get_record` | `record_id` | full confirmed extraction |
| `list_medications` | `from?`, `to?` | medications joined with record date + doctor |
| `compare_lab_results` | `test_name` | values over time **only if same unit**; otherwise report mismatch |
| `generate_visit_brief` | `specialty`, `record_ids[]` | 2nd Gemini call → sections: Reason for visit · Relevant history · Medications recorded · Recent tests · Questions to ask — every line cites a record id |
| `request_approval` | `record_ids[]`, `duration_hours`, `brief` | **returns to client** → UI shows approval card; loop stops |
| `verify_document` | `record_id` | re-download file, recompute commitment, `chain.verifyRecord` |

`create_share` and `revoke_share` are **not** model tools — they run only from the user's Approve / Revoke buttons. That is your safety story.

**Loop sketch**

```ts
const contents: any[] = [...history, { role: "user", parts: [{ text: msg }] }];
for (let step = 0; step < 6; step++) {
  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash", contents,
    config: { systemInstruction: AGENT_SYSTEM, tools: [{ functionDeclarations: TOOLS }] },
  });
  const calls = r.functionCalls ?? [];
  if (!calls.length) return emit({ type: "answer", text: r.text });
  contents.push(r.candidates![0].content);
  for (const c of calls) {
    emit({ type: "step", name: c.name, args: c.args });                 // AgentTrace
    if (c.name === "request_approval") return emit({ type: "approval", ...c.args });
    const result = await runTool(c.name!, c.args, userId);             // lib/tools.ts
    contents.push({ role: "user", parts: [{ functionResponse: { name: c.name, response: { result } } }] });
  }
}
```

Stream with a `ReadableStream` (newline-delimited JSON). Fallback if short on time: return all steps at once and animate them client-side.

---

## 7. Sharing flow

### Create — `POST /api/share` (called by the **Approve** button)

1. `token = randomToken()` (only in QR URL), `tokenHash = sha256(token)`.
2. `shareChainId = randomHex32()`, `scope = scopeHash(recordIds)`, `expiry = now + hours`.
3. Insert `share_permissions` + `share_records`.
4. `tx = chain.createShare(shareChainId, patientChainId, scope, BigInt(expirySeconds))`.
5. Return `url = APP_URL/s/{token}`, QR (`qrcode.toDataURL(url)`), explorer link.

### Doctor view — `/s/[token]` → `GET /api/s/[token]`

1. Look up by `sha256(token)` → missing → "Invalid link" (log `invalid`).
2. DB status + `chain.isShareActive(shareChainId)` → inactive → "This access has expired or been revoked."
3. Return brief + only the shared records (60-second signed URLs) + "Integrity verified ✓" per record.
4. Fire-and-forget `chain.logAccess(shareChainId)` → insert `access_logs` with the tx hash.
5. Page: read-only, no login, "Shared by patient · expires in 23h 12m", "Not medical advice" footer, `noindex`.

### Revoke — `POST /api/share/[id]/revoke`

Owner check → `chain.revokeShare(shareChainId, patientChainId)` → status `revoked` → doctor page refresh shows "revoked".

### Verify — `POST /api/verify`

Re-hash the stored file → recompute commitment → `verifyRecord`. Demo: upload an **edited copy** of a report in "Verify a file" → red "Modified — does not match the registered version".

---

## 8. Screens (mobile first · teal #087F75 on #F0FDFA · Manrope + Inter)

| Screen | Must show |
|---|---|
| Landing / login | Tagline, "Continue with Google" |
| Dashboard | Counts (records, active shares); buttons: Scan · Ask Sehat AI · Share |
| Upload | Camera/file input → "Reading your document…" → **confirm form** with uncertain fields in amber → Save → toast "Saved · integrity anchored on Avalanche" |
| Timeline | Grouped by year; card = date, type icon, doctor, one-line summary, medicine chips; filters: type, doctor |
| Sehat AI | Chat + **AgentTrace** (steps with ticks) + brief card with citations + **approval card** (record checklist, 1h/24h/7d, Approve) → QR card |
| Share | Active / expired / revoked shares, access count, Revoke, explorer links |
| Privacy | "What's on-chain" explainer, per-record "Integrity verified", Verify-a-file, contract link |
| Doctor view | Brief on top, record list, open document, expiry countdown, revoked state |

Hide hashes and addresses behind "View proof" links — patients see plain words.

---

## 9. Synthetic demo data (fictional patient "Ayesha Khan", 2022–2026)

| # | Date | Type | Content idea |
|---|---|---|---|
| 1 | 2022-03 | Prescription (handwritten) | GP, fever + cough, antibiotic 5 days |
| 2 | 2022-09 | Lab report | CBC, Hb 11.2 g/dL |
| 3 | 2023-02 | Prescription (printed) | Gastro, stomach pain, PPI 4 weeks |
| 4 | 2023-06 | Consultation note | Gastro follow-up, improved |
| 5 | 2024-01 | Lab report | Lipid profile, LDL 162 mg/dL |
| 6 | 2024-01 | Prescription (handwritten) | Physician, statin started |
| 7 | 2024-08 | Lab report | HbA1c 8.2 % |
| 8 | 2024-08 | Prescription (printed) | Metformin 500 mg |
| 9 | 2025-02 | Lab report | HbA1c 7.5 %, LDL 128 |
| 10 | 2025-05 | Cardiology consult + ECG | Palpitations, ECG normal, follow up if recurs |
| 11 | 2025-11 | Discharge summary | Dengue admission, 3 days |
| 12 | 2026-03 | Lab report | HbA1c 7.1 %, LDL 110 |
| 13 | 2026-03 | Prescription (handwritten, **deliberately unclear**) | shows uncertainty flags |
| 14 | 2026-06 | Allergy record | Penicillin allergy noted |
| 15 | 2026-10 | Prescription (printed) | Physician review, continue meds |

Fake clinic letterheads, stamps and handwriting — clearly fictional. Pre-load 14 into the demo account; **keep one handwritten prescription for the live upload.** The cardiology demo should pull #5, #9, #10, #12, #14 and current medicines.

---

## 10. Team split (4 people)

| Member | Owns | First deliverable (by ~10 PM) |
|---|---|---|
| **A — Chain** | Contract, Remix deploy + verify, `lib/chain.ts`, `lib/hash.ts`, share/revoke/verify routes | Contract on Fuji + a script that registers a dummy record |
| **B — AI** | `/api/extract`, agent loop, tools, prompts, brief | Extraction returns correct JSON for 3 sample docs |
| **C — Frontend** | All screens, AgentTrace, QR card, doctor view, polish | Upload + confirm screen against mocked JSON |
| **D — Backend + pitch** | Supabase schema/auth/storage, `/api/records`, seed data, README, deck, video | Login works + records saving |

**Hour-0 agreement (15 min, everyone):** freeze the extraction JSON (§6a), table names (§4) and contract signatures (§3). Then build in parallel against mocks.

**Only 2 people?** A+D (chain + backend) and B+C (AI + frontend). Drop lab comparison, the Verify-a-file UI and Urdu.

---

## 11. Hour-by-hour (Fri 8 PM → Sat 9:45 AM)

| Time | Milestone (check before moving on) |
|---|---|
| 20:00 | Repo + Next.js + Supabase + env. **Contract deployed and tested in Remix.** |
| 21:30 | Login; upload → extract → confirm → save (no chain yet) |
| 23:00 | Save anchors on Fuji (tx visible on explorer) ✅ |
| 00:30 | Timeline with seeded data + filters |
| 02:00 | Agent: search + brief + visible steps (no sharing yet) |
| 03:30 | Approve → on-chain share → QR → doctor view on a 2nd phone ✅ |
| 04:30 | Revoke + access log + verify. **FEATURE FREEZE.** |
| 04:30–06:30 | Sleep in shifts (two at a time) |
| 06:30 | Deploy to Vercel, run full 7-step flow on 2 phones over mobile data |
| 07:30 | Fix only demo-breaking bugs. Record the 2-min backup video. |
| 08:15 | README, 6-slide deck, submission form draft |
| 09:00 | Rehearse twice with a timer. Submit. |

**Behind at 02:00:** drop lab comparison + Verify-a-file. **Behind at 03:30:** drop on-chain access log (keep create/revoke). **Never drop:** extract → timeline → agent brief → QR → revoke → on-chain proof.

---

## 12. Test checklist (run at 06:30 on the deployed URL)

- [ ] New Google account → profile + patient chain id created
- [ ] Upload handwritten prescription → fields extracted → uncertain fields amber → save → tx on explorer
- [ ] Timeline shows it in the right year
- [ ] Agent: "When was my last blood test?" → correct date + citation
- [ ] Agent: "What is my blood pressure medicine?" (not in data) → "couldn't find"
- [ ] Agent: "I'm seeing a cardiologist tomorrow, prepare and share for 24 hours" → steps → brief → approval card
- [ ] Approve → QR → opens on 2nd phone over mobile data → only selected records shown
- [ ] Access event visible on the explorer
- [ ] Revoke → 2nd phone refresh → "revoked"
- [ ] 1-minute share expires → denied
- [ ] Random token → "Invalid link"
- [ ] Verify an edited file → "Modified"
- [ ] No secrets in git (`git status`, check `.gitignore` has `.env*`)

---

## 13. Demo script (3 min)

1. **0:00** "Raise your hand if you've ever lost a prescription or report." Hold up a bag of papers.
2. **0:20** Photograph a handwritten prescription → fields appear → one amber field → confirm → "integrity anchored on Avalanche."
3. **0:45** Timeline: five years in one scroll.
4. **1:00** Type: *"I'm seeing a cardiologist tomorrow. Prepare my history and share it for 24 hours."* Steps tick live → brief with citations → approval card → Approve → QR.
5. **1:40** A judge scans the QR → sees brief + reports, no app, no login.
6. **2:05** Fuji explorer → `ShareCreated` and `ShareAccessed` events.
7. **2:20** Tap Revoke → judge refreshes → "Access revoked."
8. **2:35** "No medical data on-chain — only proofs and permissions."
9. **2:50** "Your medical history should follow you, not your hospital. SehatVault."

---

## 14. Pitch deck (6 slides)

1. Your health history shouldn't live in a plastic bag (problem + story)
2. Meet SehatVault: Scan · Understand · Prepare · Share · Control
3. Live demo
4. Architecture: AI agent + encrypted off-chain storage + Avalanche proofs (diagram from §1)
5. Who it's for + roadmap (family profiles, emergency QR, lab/clinic integrations, embedded wallets) + model (free patient, Rs 499 premium, clinic plan)
6. Team · GitHub · contract address · live app QR

---

## 15. Judge Q&A (short answers)

- **Why blockchain?** Independent, tamper-evident proof of each document and every permission change. Data stays encrypted off-chain.
- **Who signs transactions?** A relayer in the prototype; embedded patient wallets in production.
- **AI misreads?** Uncertain fields are flagged, the patient confirms, the original is always attached.
- **Diagnosis?** No. It organizes and cites your own records and never recommends medicine.
- **QR leaked?** It expires, can be revoked, and every access is logged; PIN/recipient auth in production.
- **Is a report genuine?** Integrity yes; issuer authenticity needs signed lab/hospital reports (roadmap).
- **Hospitals?** Not needed to start — patient-side value from day one.

---

## 16. Submission checklist

- [ ] Live Vercel URL
- [ ] Public GitHub repo, no secrets, README (problem, features, architecture, setup, contract address, screenshots, AI usage + limitations)
- [ ] Contract address + deploy tx + verified source on the Fuji explorer
- [ ] 2-minute backup demo video
- [ ] Deck PDF
- [ ] Demo account seeded and tested on 2 phones
- [ ] Relayer wallet still holds Fuji AVAX
- [ ] Team contributions listed
- [ ] Official submission form completed

## 17. Risks → fixes

| Risk | Fix |
|---|---|
| Wi-Fi fails | Hotspot + backup video |
| Fuji RPC slow | Don't block UI on receipts; show "anchoring…" then ✓ |
| Gemini misreads the live doc | Rehearse with the exact paper you'll use, in good light |
| Agent loops or hallucinates | Max 6 steps, strict tools, citations required, pre-tested prompts |
| Relayer out of gas | Keep ≥ 1 AVAX; a second funded wallet ready |
| Running late | Follow the cut list in §11 |
