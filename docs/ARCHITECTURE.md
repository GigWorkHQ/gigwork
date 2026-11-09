# Architecture

This describes the live system as built. The original product brief and handoff spec (`BACKEND-IMPLEMENTATION.md`, `DEPLOYMENT.md`, `source/`) describe a larger design, including on-chain escrow contracts and passkey accounts. That design was **not** built as written; where the two differ, this file is current.

## Components

```
Browser (React/Vite on Vercel)
   │  SIWE sign-in → bearer session token (sha256 + pepper stored, 7 days)
   ▼
GigWork API (Express 5 on Bun, Render, one instance)
   ├── Postgres: users, work, escrow ledger, encrypted escrow keys, settlements, review cases
   ├── Keeper loop (every 30 s, advisory-locked): default approval, expiry refunds, Pay runs,
   │   reviewer draws, payout retries, ops alerts, nonce sweep
   └── viem → Robinhood Chain RPC: verify deposits, read balances, send signed payouts
          ├── Escrow wallets (one per job, batch, gig, contract), keys AES-encrypted under DATA_ENCRYPTION_KEY
          ├── Gas wallet: tops up escrow wallets with ETH for payout gas
          └── Bonus vault: a separate escrow wallet that pays referral bonuses only
```

### Money flow

1. **Fund.** The client sends the exact USDG amount from its signed-in wallet to the item's escrow address, then posts the transaction hash. `verifyJobFunding` checks the chain, the sender, the token contract, the exact amount, the recipient and the confirmations, then records the deposit. Each transaction hash can fund only one thing.
2. **Credit.** Approval, default approval, a Pay run or a dispute ruling creates an `escrow_transfers` row (batches, gigs, contracts) or a `job_settlements` row (jobs). Unique keys make each credit happen once.
3. **Pay.** The payout worker leases the escrow, tops it up with gas, signs the ERC-20 transfer, and persists the signed transaction before broadcasting it. A restart re-sends the same bytes; it never re-signs a payout that might already be mined.
4. **Recover.** A client can send back any USDG its escrow holds above what it owes (`GET /v1/recoverable`, `POST /v1/escrows/:id/recover`, or `POST /v1/jobs/:id/cancel` for jobs).

## Invariants

These hold for every escrow, and the tests check them (`backend/tests/integration/`).

1. **Payouts are backed by recorded deposits.** For each escrow, the sum of payouts and refunds of deposit money never exceeds the sum of recorded deposits.
2. **Recoveries only return unrecorded money.** Surplus refunds never exceed the USDG that arrived without a recorded deposit. In `escrowPosition`, a payout in flight counts as paid only once its own transaction is mined, so the surplus is never overstated.
3. **A deposit is recorded only while the escrow holds it.** A transfer whose USDG was already returned by a recovery can't be recorded later as funding (`funding_not_held`).
4. **One transaction hash funds one thing** (`escrow_deposits.tx_hash`, `jobs.funding_tx_hash` unique).
5. **One credit per subject** (`escrow_transfers (kind, ref_id)` unique; one `job_settlements` row per job).
6. **No nonce is signed twice.** Each escrow has one leaseholder that signs, and the gas wallet signs under `GAS_WALLET_LOCK` with a unique nonce index. A receipt lookup that errors is never read as "not mined".
7. **Bonuses never touch client escrow.** Referral bonuses are paid only from the bonus vault, after team approval.
8. **Team rulings choose between the two parties.** No route lets a team wallet send escrow funds to a third address.

## Threat model

| Threat | Mitigation | Residual |
| --- | --- | --- |
| Theft of another user's work or funds (IDOR) | Every route checks that the caller owns the object; covered by route tests | — |
| SQL injection | Parameterised queries only | — |
| Session theft or replay | SIWE with a single-use, expiring nonce bound to the domain and chain; tokens stored hashed with a pepper | Bearer tokens in browser storage |
| Leaked agent API key | Keys can't manage keys, claim bonuses, recover funds or use team routes | A key can still post work and read its owner's submissions until revoked |
| Referral farming (self-dealt work) | Counts only work of at least 1 USDG from 3 or more distinct clients that are not the referee, the referrer, or linked to either through the referral graph; team approval before any claim; the bonus is capped at 25 USDG by config | A determined sybil with real capital and unlinked wallets still has to pass team review |
| Gas-wallet drain | 0.1 USDG minimum per listing; 100 new listings per client per day; per-IP write limits; low-balance alerts | Payouts pause if the wallet empties; no funds are lost |
| Stuck deposits | Client recovery for every escrow kind; expired jobs refund through cancel | — |
| Double payout after a restart | Signed transactions persisted before broadcast; only a definite not-found clears a send | — |
| Failed payout (issuer freeze) | Failed-payout queue with logged team retry to the same recipient | Needs a human |
| Operator or infrastructure compromise | Secrets held only on the host; the encryption key is separate from the auth pepper | **Accepted:** custodial escrow (see SECURITY.md) |
| Dependency advisories | Exact pins and a frozen lockfile; OSV, CodeQL and gitleaks run in CI | — |

## Live deployment

| Item | Value |
| --- | --- |
| Chain | Robinhood Chain mainnet, id `4663`, explorer https://robinhoodchain.blockscout.com |
| USDG token | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` (6 decimals) |
| Gas wallet | `0xebcdb43e205fb58b1e6a727d4991792ba4d6e92c` |
| Confirmations | 2 |
| Bonus vault | Shown to team wallets at `GET /v1/team/bonus-vault` |
| Escrow wallets | One per item, shown on each item in the app and in API responses (`escrowAddress`) |

Anyone can check these against the running API at `GET /v1/config`, and check the gas wallet and payout health at `GET /health/ops`. `GET /health` reports the deployed commit.

## Audit history

| Date | Review | Result |
| --- | --- | --- |
| 2026-11-08 | AI audit grade (rubric v2), commit `c685b38`, backend only | **2.7 / 10.** 1 High, 2 Medium, 5 Low, plus 2 reachable High advisories in dependencies |

Fixes made in response:

| Finding | Fix |
| --- | --- |
| H-1: referral bonus farmable with self-dealt micro-jobs | Distinct, unlinked third-party clients rule; 1 USDG minimum per qualifying item; bonuses need team approval; 0.1 USDG minimum on every listing; bonus capped at 25 USDG by config |
| M-1: USDG sent to an expired job was stuck | `expired` added to the job recovery paths |
| M-2: unrecorded batch, gig or contract deposits were stuck | Client recovery route for every escrow, plus a deposit guard so a recovered transfer can't be recorded later |
| L-1: team powers reachable by API key | `requireTeam` requires a wallet session |
| L-2: no rate limits; nonces never swept | Per-IP limits on sign-in and writes; keeper deletes expired nonces |
| L-3: gas wallet drainable | Minimum amount, daily listing cap, low-balance and failed-payout alerts, `/health/ops` |
| L-4: receipt lookup error could cause a double payout | Only a definite not-found clears a signed transaction |
| L-5: failed payouts never retried; bonus balance read outside its lock | Failed-payout queue with logged retries; vault balance read under the lock, with failed transfers counted as owed |
| Advisories: body-parser (via express 5.1.0), zod 3.25.76 | express 5.3.0, body-parser 2.4.0, zod 4.6.7 |
| Testing | Postgres 16 in CI; route tests for every auth rule; randomized model-based escrow invariant test |
| Ops and docs | README, SECURITY.md, LICENSE, `.env.example`, this file, RUNBOOK.md, team action log, CI hardening |
| Found while fixing | `/v1/cron/settle` was unreachable because the account router's auth answered first; it is now mounted first |

## Roadmap

1. **Move escrow on-chain:** deposit, release, refund and timeout in audited contracts that pay only one of the two parties, owned by a Safe. This removes the custodial risk.
2. Put team wallets behind a Safe.
3. Encrypt escrow keys through a KMS instead of one environment secret, with per-transaction and daily outflow caps.
