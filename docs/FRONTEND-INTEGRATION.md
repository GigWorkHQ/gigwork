# Frontend integration map

Snapshot: 18 October 2026. This describes the code that exists now. Suggested command/API shapes below are **proposals**, not implemented endpoints. The backend brief explicitly names `POST /v1/batches` for x402 create-and-fund; it does not define a complete REST API.

## Live jobs slice (implemented 26 October 2026)

`/app/jobs` and `/app/team` are connected to the GigWork backend; every other `/app/*` screen remains the labeled local preview and never falls back to live data or vice versa.

| File | Role |
| --- | --- |
| `src/api.js` | Fetch client. Base URL from `VITE_API_BASE_URL` (default `https://gigwork-api-uhpj.onrender.com`). Bearer session kept in `localStorage` (`gigwork-session-v1`) and cleared on logout, expiry or any 401. |
| `src/wallet.js` | EIP-1193 helpers: connect, chain switch, `personal_sign` of the exact server SIWE message, and an ERC-20 `transfer` to the job escrow. No keys or RPC secrets in the browser. |
| `src/live.js` | Pure rules mirrored from the backend: status labels, role/action gating, amount/job/submission validation. Tested in `src/live.test.js`. |
| `src/LiveJobs.jsx`, `src/live.css` | Wallet sign-in, open/my jobs, create → fund (wallet transfer or pasted tx hash, retried until confirmations land) → claim → submit → request changes / accept / dispute, and the team dispute console. |

Chain ID, chain name, explorer, USDG address/decimals and confirmations come from the public `GET /v1/config` endpoint, not UI constants. The backend only answers browser requests from origins in `CORS_ORIGINS` (comma-separated; defaults to the `AUTH_URI` origin). `AUTH_DOMAIN`/`AUTH_URI` should match the deployed frontend host so wallets show the correct sign-in domain.

## Platform features (implemented 27 October 2026)

Everything in the sidebar group **Live on Robinhood Chain** is connected. The preview group below it is unchanged sample data.

| Route | File | What it does | API |
| --- | --- | --- | --- |
| `/app/jobs` | `LiveJobs.jsx` | Jobs, plus client cancel (unfunded → cancelled, unclaimed → refunded, claimed and 72h past deadline with no submission → refunded), default approval after `JOB_REVIEW_HOURS`, tips | `/v1/jobs/*` incl. `POST /:id/cancel` |
| `/app/tasks` | `LiveTasks.jsx` | Quick tasks. Workers: list, claim under a lease, submit/skip, dispute a rejection. Clients: create batch (≥ 6 USDG/estimated hour, review ≥ 24h), fund, approve/reject/approve-all, close (unused balance refunded) | `/v1/tasks/*`, `/v1/batches/*` |
| `/app/live-gigs` | `LiveGigs.jsx` | Milestone gigs: invite by handle/wallet or list publicly once the first milestone is funded; fund each milestone; start/submit/revise/approve; dispute (reviewer may split); cancel only unstarted or overdue milestones | `/v1/gigs/*` |
| `/app/payruns` | `LiveContracts.jsx` | Contracts: offer/accept, reserve pay periods back to back, automatic Pay run at period end, rate change with worker consent, end (unstarted periods refunded), CSV pay statement | `/v1/contracts/*` |
| `/app/earnings` | `LiveAccount.jsx` | Payouts and refunds with tx links, tips received, work history built only from completed escrow payouts, share selected entries at `/h/:slug` | `/v1/payouts`, `/v1/history*`, `/v1/public/history/:slug` |
| `/app/account` | `LiveAccount.jsx` | Pay handle, stock-token payout choice, referral code/bonuses, agent API keys | `/v1/me*`, `/v1/payouts/*`, `/v1/referrals*` |
| `/app/reviewing` | `LiveReviews.jsx` | Reviewer queue (only for wallets the team added) | `/v1/reviews/*` |
| `/app/team` | `LiveReviews.jsx` | Team console: all review cases, job disputes, reviewer list, bonus budget wallet | `/v1/team/*` |
| `/h/:slug` | `SharedHistory.jsx` | Public share page; recomputes each entry's salted SHA-256 commitment in the browser and links payout transactions | `/v1/public/history/:slug` |

Backend pieces: `backend/db/migrations/003_platform.sql`; `ledger.ts` (per-batch/gig/contract escrow wallets, verified deposits, idempotent payouts with gas top-ups sharing the gas-wallet nonce lock); `batches.ts`, `gigs.ts`, `contracts.ts`, `reviews.ts`, `account.ts`; `keeper.ts` runs every 30s and on `POST /v1/cron/settle` (lease expiry, default approvals, expiry refunds, Pay runs, reviewer draws/redraws/escalation, payout retries).

**Rules as implemented.** Reviewer draw happens `REVIEW_DRAW_DELAY_MINUTES` (60) after a dispute using a CSPRNG over active reviewers excluding both parties; deadline `REVIEW_DEADLINE_HOURS` (72); one redraw, then escalation to the team. Workers can dispute a quick-task rejection within `DISPUTE_WINDOW_HOURS` (72). Tips are direct client→worker USDG transfers on credited work, capped at 100% of the item's pay. Referral: each code admits `REFERRAL_MAX_INVITES` (5) people in their first 14 days; after `REFERRAL_MIN_APPROVED` (10) approved items and `REFERRAL_MIN_DAYS` (7), both sides can pull-claim `REFERRAL_BONUS_USDG` (3) from the bonus vault (address in the team console); an empty vault leaves bonuses claimable. Agent API keys (`gwk_…`, hashed at rest) act as their owner but cannot manage keys or log out; batches they create are marked `agent`.

**Deliberate limits.** No platform fees are charged (workers and clients pay listed amounts only). Stock-token payouts: `STOCK_TOKENS` lists electable tokens and `STOCK_EXCLUDED_COUNTRIES` blocks regions, but no swap route is implemented, so every payout is sent in USDG and records the fallback. Escrows are backend-held keys, not audited contracts; nothing pays out if the API and its database are down.

## Runtime and routes

React + Vite, plain CSS, lucide-react. `src/main.jsx` selects marketing, `Docs` or `Dashboard` from `location.pathname`. Navigation uses native links; hosting needs SPA fallback. `Dashboard` selects the third path segment. `Marketplace` reads `/app/work/:id` and has a not-found state.

| Route | Current source / behavior | Production replacement |
| --- | --- | --- |
| `/` | `main.jsx`; marketing, motion, anchors, FAQ/roadmap | Keep approved design and change product claims only when enabled |
| `/docs/:slug` | `Docs.jsx`; nine guides | Align integration status and fees with approved live configuration |
| `/app/overview` | `DashboardOverview.jsx`; local summaries/charts | Authenticated work, ledger/history and pending-work queries |
| `/app/work` | `MarketBrowse`; local filters/bookmarks | Funded, policy-cleared, calibrated listings; server eligibility/pagination |
| `/app/work/:id` | `JobDetail`; brief, pay, requirements, report, claim modal | Versioned public brief plus worker-owned assignment; private content after claim |
| `/app/my-work` | `Dashboard`; sample assignments | Worker-owned assignments, server clocks and receipts |
| `/app/batches` | `BatchModal`; quote and simulated funding | Policy/redaction, calibration, signed quote and confirmed funding before listing |
| `/app/gigs` | `gigAction`, cards, `TextModal` | GigEscrow commands, invitations, delivery storage, deadlines and partial-work evidence |
| `/app/contracts` | `Contracts`; reserve/run, stream flag, rate consent | Team roles/thresholds, period reservations, signatures and paidThrough |
| `/app/payments` | `Payments`, `WithdrawModal`, `StockModal` | Ledger, destinations, eligibility, receipt states and pay statements |
| `/app/profile` | `Profile`; handle/tier/history selection | WorkerPass, attestations, stake, accuracy and history commitment/reveal services |
| `/app/reviews` | `ReviewList`, `ReviewModal` | Requester/reviewer authorization, reasons, delayed draw and deadlines |
| `/app/developer` | `Developer`; example payload copy/download | Scoped API credentials, results API, SDK/MCP and x402 receipts |
| `/app/settings` | `SettingsPanel`; sample reset/preferences | Account preferences and recovery; clearly separate preview controls |

Find the named symbols with repository search; line numbers will change. `dashboard-refined.css` intentionally overrides older dashboard materials, and `marketplace.css` is scoped to marketplace surfaces. Preserve those overrides while extracting data access.

## Exact state and command seams

| Existing seam | Current behavior | Live behavior to implement |
| --- | --- | --- |
| `seed`, `readState`, `KEY`, `setData` in Dashboard | One localStorage object, both roles trusted | Authenticated bootstrap and role-scoped queries; browser state never grants ownership or funds |
| `initialTasks`, `initialGigs`, `initialHistory` in domain | Six tasks, two gigs, four history entries | Keep as preview-only fixtures; live errors must not silently fall back to samples |
| `taskAction` / `transitionAssignment` | Synchronous status and balance/history updates | Atomic lease, submission, review, receipt reconciliation and exactly-once credit |
| `TaskModal` | Sample choices, local timer and response validation | Server-leased content, format validation, server deadline, release/expiry recovery |
| `BatchModal`, `batchQuote`, `validateBatch` | Form guards and decimal-number quote | Calibrated time, screened items, signed immutable quote, reserve and funding receipt |
| `gigAction` / `TextModal` | Local status/text; no delivery upload | Object storage + hashes, assignee checks, funded-before-start and partial-work resolution |
| `Contracts` | Local reserve arithmetic, consent toggle, one-shot run | Team threshold, accepted offers/rates, one checkpoint, notice and reservation ledger |
| `Payments` / `WithdrawModal` | Local balance decrement and CSV export | Signed payout intent, verified destination and immutable payout/statement records |
| `StockModal` / `stockEligibility` | Country exclusion demo and split preference | Verified issuer rules, allow-list, default-zero election and risk acknowledgement |
| `Profile` / history export | Local selection exported to JSON | Escrow-only commitments, salts/reveals, distinct clients and linked-account flags |
| `save` in Marketplace | Local `savedJobs` ID array | User-owned bookmarks shared by catalog and detail queries |
| Report/appeal callbacks | Text appended to local arrays | Durable human queue, auditable decisions and worker feedback |
| `notify` / toast | Immediate local confirmation | Success only after accepted command; settlement only after verified receipt |

**Migration traps identified in the current sample:** `taskAction` queues `setData` and emits its success toast outside that updater; an invalid transition caught inside can be followed by the generic success toast. Replace this with an awaited command result before live integration. Batch availability counts are static labels, not concurrency controls. The timer uses the browser clock. Decimal JS numbers are unsuitable for token accounting. Role/country/tier controls are not authorization or eligibility proofs. A JSON history export is not a public share service. The stream toggle does not settle real accrual.

## Proposed service boundary

Keep the existing screen components. Extract data access behind explicit `preview` and `live` adapters. No live adapter or mode flag is installed by this handoff.

Queries: session/bootstrap; funded listings + cursor; public brief; owned assignment/work list; client batches; gigs; team/contracts; ledger/statements; reviews; WorkerPass/history; bookmarks.

Commands: quote/post/fund; claim/release/submit; approve/reject; report/appeal; invite/accept/start/progress/submit milestone; propose/accept rate; reserve/run/end contract; withdrawal; payout election; selected history reveal. Map monetary operations to the exact source contract interfaces, not an unauthenticated generic endpoint.

Suggested mutation envelope: `{commandId, expectedVersion, payload}` plus a server-authenticated principal. Suggested response: `{commandId, acceptedVersion, serverTime, status, receiptId?, txHash?, error?}`. Keep idempotency keys stable over retries; stale versions return conflicts and refreshed state. Use integer base-unit strings and verified currency/network metadata. Keep pay, client fees, review reserves and reserved/unreserved balances separate.

No private keys, signer authority, RPC secrets or privileged commands belong in browser code, localStorage or `VITE_*` variables. Public configuration is distinct from private server configuration.

## States that live wiring must complete

Loading, empty, denied, retryable error, stale/conflict, expired claim, insufficient tier, region ineligible, quote expired, signature rejected, wrong account/network, submitted/pending confirmation, confirmed, failed and reconciled. Reject duplicate pending operations inside the handler. Preserve dialog focus and announce status. Derive countdown display from server time, but leave expiry enforcement to server/contracts. Revalidate after reconnect/account change; multiple tabs and reloads must converge on the ledger.

## First integrated vertical slice

Run the unchanged frontend; implement the original M1/M2 foundations; extract the adapters without redesign; connect listing -> detail -> claim -> submit -> review -> credit for a funded Judge/Verify batch in staging. Test two accounts, two competing claims, expiry, signature cancellation, API outage, replayed submit/credit and offline default approval. Keep the labeled local preview working while later milestones are built.
