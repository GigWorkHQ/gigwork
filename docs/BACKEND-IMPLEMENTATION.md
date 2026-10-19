# Backend implementation checklist

**Required** means specified in the supplied originals. **Current** means implemented in this frontend. **Proposed** means an integration design to confirm. **Unresolved** means a configuration, policy or interpretation still needing evidence. This guide does not deploy or verify any backend provider.

Source of truth: `source/Workloom Backend.pdf` (10 pages) and `source/Workloom Overview.pdf` (9 pages), prepared 16 October 2026. Page references below are one-based PDF pages. The originals are included unchanged; the package manifest records their hashes. Document launch tactics and operational commands are reference material, not fresh authorization to execute them.

## 1. Starting point and scope

**Current:** complete website and interactive local preview. Marketing, nine guides, full-screen dashboard, marketplace/details, forms, charts, task/gig/contract/payment sample flows and local history are present. No authenticated live service, smart contract, database, worker queue, real account, transaction, public history verifier, native mobile or Telegram implementation is present.

**Required stack (Backend p. 1):** TypeScript on Bun; Hono + tRPC; Drizzle on Postgres (+ Timescale); BullMQ/Redis; viem; Dwellir archive RPC; Foundry/Solidity 0.8.x. Accounts: ZeroDev Kernel passkeys, EntryPoint v0.7, ZeroDev/Alchemy bundlers, second device or backup signer. These are source selections, not a claim they are currently configured or compatible.

Preserve the React/Vite frontend. Backend stack selection does not require a frontend rewrite. Keep `domain.js` as a sample/display reference; monetary enforcement belongs in reviewed contracts and authenticated services.

## 2. Original milestone order and acceptance gates

This preserves Backend pp. 9-10. The day estimates and W1-W8 roadmap are planning material, not deadlines promised by this delivery. Each gate below combines source invariants with concrete proposed verification.

| Order | Required scope | Acceptance before proceeding |
| --- | --- | --- |
| M1 | TaskEscrow + ReviewerSet: claim, submit, defaults, delayed draw, refunds, topUp; fuzz | Fund-before-list; replay cannot double-credit; submitted/disputed pay never refundable; unpredictable-at-reject draw test against simulated sequencer; defaults/refunds work without Gigwork services |
| M2 | WorkerPass, device attestation, tiers, StakeVault | Recover passkey on second signer; genuine-device vs unique-person distinction retained; tier/stake limits, exit/freeze/slash/appeal boundaries and screening tested |
| M3 | Policy service, independent calibration, matching | Every posting entry point screened; personal-data fields blocked; independent p65 estimate; below-floor batch cannot list; language/region/tier eligibility enforced |
| M4 | Quality engine, test questions, agreement, appeals, results API | Random/rotated tests, contested-item retirement, paid tests, per-type accuracy pause + appeal; quality never reduces listed pay; extra assignment stays in budget |
| M5 | Connect web flow, USDG PayoutRouter, pay handles | Real listing/claim/submit/skip/history path; exact credits; withdrawal and payoutBatch callable offline; documented sponsorship and <=6h payout scheduling |
| M6 | Agent REST/SDK/MCP, x402; Test/Label | Same policy/escrow rules as human requests; atomic create+fund witness; agent authorization and idempotent retries; tested synthetic-account sandbox |
| M7 | GigEscrow + client dashboard | Accepted assignee, funding before start, progress/delivery hashes, >=72h review, consented extension, delayed review and deadline+grace partial split |
| M8 | PayRuns + team/contract dashboard + statements | Reserve before period; one paidThrough for run/stream; no reserved withdrawal; future rate consent; notice settlement; offline run/reserveNext |
| M9 | Optional stock-token legs, holdings, tips | Verified issuer/country route; market/oracle/multiplier checks, allow-list, 0.5% bound, depth cap, per-worker USDG fallback; only credited-work tips |
| M10 | WorkHistory/reveal pages, BonusVault; Telegram only if permitted | Escrow-only entries, independent commitment verification, distinct clients/cluster flags; fixed separate pull bonus budget; Telegram rules validated before enabling |
| M11 | Local tasks | Allowed public-commercial categories, signed capture validated, face/plate blur, EXIF removal, coarse geofence/time output and repeat-targeting limits |

## 3. Specification-to-service traceability

| Source | Required behavior | Service / contract | Frontend integration point |
| --- | --- | --- | --- |
| Backend pp. 1-2 | Policy, work, pricing, match, quality, attest, review, payouts, identity, notify modules | Backend composition; signer and reviewer boundaries | `Dashboard` bootstrap and typed query/command adapter (proposed) |
| Backend pp. 2-3 | Batch inputs, forbidden work, sandbox, redaction, requester attestation | Policy/work services | `BatchModal`, job briefs, reports and developer payloads |
| Backend p. 3 | Independent calibration, p65 time, $6/hour floor, realized-rate breach and top-up | Pricing + TaskEscrow | Listing estimates, quotes, batch status |
| Backend p. 3 | Test/format/agreement checks, accuracy pause and appeals | Quality + 2-of-3 attest | `TaskModal`, profile accuracy, reviews/appeals |
| Backend p. 4 | Funded tasks, lease, review/default/dispute/draw, refund/top-up | TaskEscrow + ReviewerSet | `taskAction`, `ReviewModal`, `My work` |
| Backend pp. 4-5 | Gig invitation, acceptance/start/progress/delivery, extension, partial split | GigEscrow | `gigAction`, milestone cards, delivery modal |
| Backend p. 5 | Team threshold, offer acceptance, reserve/run/stream, rate consent, end/withdraw | PayRuns | `Contracts`, pay statements |
| Backend p. 6 | Elections, withdrawals, batch payouts, stock route fallbacks and tips | PayoutRouter | `Payments`, `WithdrawModal`, `StockModal`; tips UI still to implement |
| Backend p. 6 | Commitment entries, selected reveal, cluster flags/distinct clients | WorkHistory + reveal service | `Profile`; local JSON export is only a preview |
| Backend pp. 6-7 | WorkerPass/device/tier/stake/sanctions controls | Identity + WorkerPass + StakeVault | Onboarding and real passkey/recovery UI to add; profile currently sample |
| Backend p. 7 | Exact Permit2 funding; x402 witness; stock-to-USDG client route | Funding adapter + escrow | Live funding/signature/receipt states to add |
| Backend p. 8 | Data schemas and retention | Drizzle/Postgres, storage, deletion/export jobs | All authenticated data; no live persistence exists yet |
| Backend pp. 9-10 | Offline money paths, fuzz properties, external review/caps | Contracts, keepers and release tests | Surface accurate receipts/default actions without relying on a UI server |
| Overview pp. 3-5 | Pay timing, worker fees, neutral stock election, holdings, tips, client fees | Ledger, payout/quote services | Pay UI, notices, future tips/holdings interfaces |
| Overview pp. 6-9 | Wind-down, limits, privacy, prohibited claims and phased availability | Product policy, release controls | Public guides, integration banner, history consent |

## 4. Monetary and state invariants

### Quick and agent tasks - Backend pp. 2-4

- Capture type, instructions, item hashes/content references, workers per item, test rate, assignment pay, claim limit, review window, region and language. Item content remains off-chain; hashes/roots are on-chain.
- No listing before actual funding. Signed quote binds terms. A task review window is at least 24 hours. Batch expiry is at least claimDeadline + claim limit + reviewWindow + 144 hours.
- Store submittedAt and checksPassed; submission removes its pay from the refundable pool. Ordinary refunds never touch submitted/disputed assignments. Only the requester can approve/reject within applicable authority; rejection needs a reason hash.
- Anyone can call approveDefault after the review window with no rejection. Review draw occurs at least k blocks after rejection using blockhash(rejectBlock+k) XOR the fixed creation seed, excluding requester-linked reviewers. Parameter k and exact expiry handling need a reviewed implementation.
- Reviewer resolution deadline: <=72 hours after draw. Default: checksPassed credits the worker; otherwise one new-draw escalation, with the source's 144-hour hard cap crediting the worker. Confirm and test the exact hard-cap anchor and missing/expired blockhash behavior; the summary does not invent those details.
- ReviewerSet governance: Safe 2-of-3 + 48-hour delay. Flat fee independent of outcome. Client-funded review reserve returns only if the requester wins. Workers never fund review fees.
- Fees are taken only on credited assignments; refund includes the fee share. Top-up raises pay and atomically funds the delta over remaining + pending assignments.
- Pricing uses independent eligible Tier >=1 calibrators, excludes failed-test and requester-cluster participants, and takes the 65th-percentile time. Below $6/hour cannot list. Realized-rate breach triggers top-up; after three days without it, cancel/refund only the unclaimed remainder.

### Quality - Backend p. 3

Tests are mixed randomly, show-rate capped, rotated per worker and not jointly exposed to clustered workers. Validate requester-written tests against high-accuracy agreement; retire contested tests. Below 80% over the last 50 test questions pauses that task type, with appeal/retraining. Test questions are paid. Accuracy/agreement never cut listed pay. Weighted agreement may allocate one more assignment only within budget; detect correlated non-test answers. Format validation runs before check attestation. Test screenshot origin metadata and signed Local capture remain explicitly unverified source assumptions.

### Gigs - Backend pp. 4-5

First milestone funded before listing; every later milestone funded before start. Invite, worker acceptance, start, progress hash and delivery hash are separate states. Review window >=72 hours. Cancellation is only before start, except the overdue path after deadline +72-hour grace with no submission: no partial hash refunds; a partial hash goes to reviewer allocation. Extensions require worker consent. Disputes use delayed draw and allow a split. Default resolution allows one escalation; at the specified hard cap a submitted milestone is credited. Do not replace this with the sample's simple cancel button semantics.

### Contracts - Backend p. 5

Worker accepts the offer. Reserve a complete period before it starts or pause and notify the worker before work. Admins can withdraw only unreserved balance. Run and streamed withdrawal share exactly one paidThrough checkpoint; pay only the remainder after streamed amounts. Worker-approved rate changes affect the next period only. Ending pays max(notice-period pay, current reserved period). Generate pay statements, not employment payslips. Confirm rounding, period boundaries and notice arithmetic in tests before deployment.

### Pay, fees and optional routes - Backend pp. 6-7; Overview pp. 3-5

Workers keep the full listed amount. Client fees: 12% quick/agent, 8% milestones, 1% Pay run capped at $15; reserves separate. Overview p. 5 specifies fee allocation of 80% operations (checks/reviews/gas/support), 10% treasury, 5% client-discount funding and 5% burn. Its utility-only working ticker $WLOOM offers client discounts up to three percentage points and early access to work types; no payout/yield and no stake reduction. The user has renamed the website Gigwork without selecting a new ticker. Preserve the source economics and confirm executable discount/cap/rounding configuration; do not infer negative fees when a three-point discount meets a 1% Pay run fee.

USDG is default; stock allocation starts at zero. Source excludes US/UK/CA/CH, subject to actual issuer rules. Stock tokens are issuer products, not shares. Show neutral choices and risks. Election eligibility cannot be established on-chain by a frontend country selector. If issuer terms do not permit the intended route, remain USDG-only.

Batch payouts are callable by anyone and scheduled at least every six hours. Use per-worker try/catch. Stock legs require allow-listed tokens/pool keys, fresh oracle, open market, no pending multiplier change, protected submission, 0.5% minimum-output bound and depth/notional cap; apply multiplier once. A failed leg falls back to USDG without blocking others. Withdrawals remain available; sponsored gas is capped at the source's 10 monthly withdrawals. Confirm all operational caps/configuration before enabling.

Tips apply only to credited work, at most 100% of item pay, with screening and worker stock eligibility; otherwise USDG. Tipper covers route cost, no Gigwork tip fee. Worker stock-route costs come only from the elected stock share, with no platform markup. BonusVault is never called by escrows and never sits in the pay path. Fixed USDG-only launch budget (Overview's $20,000 is explicitly proposed); pull claims; first five approved quick tasks +50%; $3 to each referral participant after ten explicitly approved tasks, test accuracy above the configured bar, at least seven days and Tier >=1. Maximum five invites per referrer, per-pass caps, referrer/referee and client/worker cluster exclusions, and no Tier 0 web-fallback bonuses. Do not turn proposed launch funding into a live promise.

Keep inbound client funding distinct from outbound worker payouts (Backend p. 7). Agent `POST /v1/batches` uses `payTo = TaskEscrow` and a Permit2 batch-hash witness for atomic create+fund. Client stock funding uses the client's own account, exact-amount Permit2, an exact-output swap to USDG, oracle/multiplier protections, and atomic create+fund; closed market/stale oracle reverts. Escrows hold only USDG. Confirm exact-output input-cost bounds and required token-to-Permit2 approvals rather than silently assuming the source's no-standing-allowance statement is technically complete.

## 5. Identity, privacy and policy

Backend pp. 6-8 and Overview pp. 7-8 govern these requirements:

- Passkey recovery with second device/backup signer. Attestation proves genuine app, not unique person. Web fallback is Tier 0 only; capped volume. Tier 1/2 stakes are $10/$50 USDG plus accuracy. Never let a client-side tier setting unlock real work.
- Stake exit after 14 days; at most one freeze per exit request for a named fraud review, 30 days total then release. Capped slashes need 2-of-3 reviewers plus one appeal. Confirm cap values, accuracy bars and volume limits with the owner; not all are numerically specified.
- Screen at WorkerPass mint and before submit attestation. Credited balances are never frozen. Flagged uncredited pay may be held for <=30 days during appeal, or retained where required by applicable law, and is never returned to the requester. This is a source requirement requiring qualified policy review, not a verified legal conclusion.
- Requesters see pseudonymous worker IDs per batch. Task/gig content is deleted 60 days after close, with export beforehand. Hashed fingerprints retained 90 days; payment/commitment records retained. Ensure backups, objects and derived records follow the approved policy.
- WorkHistory entries originate from escrow credit only. Commitment includes kind, client handle, skill, rating, amount, cluster flag and salt. Share only chosen entries + salts, show distinct-client count and linked-account flags, and explain payout-address/public-payment exposure before revealing.
- Policy must cover every human, agent and import entry point. Block prohibited work and personal/contact/seed-phrase answer fields; scan/redact items and record requester attestation. Test tasks use an approved sandbox or store-distributed builds with synthetic requester test accounts.
- Required blocked categories: illegal work; targeting/locating people; impersonation/calls on another person's behalf; CAPTCHA/verification bypass; fake reviews/engagement; graphic/sexual content; credentials or personal data; pay-to-work; off-platform migration; app/executable installs; wallet connection/signing/payment entry; third-party account creation; unsafe links; academic cheating; regulated work without the worker's declared licence; Local work outside allowed categories. Apply the controlled sandbox/store-build exception only to Test tasks with synthetic accounts.
- Publish the source-required requester rejection rate; define the denominator and keep it distinct from invented marketplace ratings. WorkHistory proves approved/paid work, not independent quality. Explain centralized attestors/reviewers, sequencer influence on draws and device-farm limits honestly.
- Always support skip without penalty and a human harmful-content report queue. Local tasks remain gated to allowed public commercial checks with blur, EXIF removal, signed capture, coarse geofence/time and repeat-targeting limits. No personal targeting/private property tasks.
- Original Overview specifies adults 18+ by self-declaration, independent workers, no promised employment/benefits/guaranteed work and no investment advice. Have the owner resolve the launch jurisdictions and notices; do not invent business or legal decisions.

## 6. Data model and command design

**Source schema (Backend p. 8):** requesters, workers, batches, items, assignments, gigs, milestones, contracts, reviews and payouts. Preserve on-chain IDs, content refs, test flags, pay/estimate/realized rate, claim/submit timestamps, review draw block, reason/partial hashes, paidThrough, status and transaction references. Read the original schema for exact columns. Gold answers and private content are never sent in public listing payloads.

**Proposed additions:** accounts/sessions, command-idempotency records, claim leases, immutable ledger entries, reservation entries, funding receipts, outbox/jobs, file metadata, bookmarks, appeals/reports, history reveals and audit events. Use constrained statuses, integer amounts, record versions, transaction boundaries, ownership indexes and deadline indexes. Do not use the frontend fixture object as a database schema.

Use authenticated identity, not a body-supplied role. Validate all schemas server-side. Combine command idempotency, unique ledger event keys and contract guards to reject duplicate payment. Read chain events from a checkpointed indexer; account for reorganizations and confirmation depth. Persist accepted commands and reconcile receipts before reporting settlement. Provider/webhook retries must be safe to replay.

## 7. Jobs and operations (proposed implementation)

Queue claim expiry, default approval, delayed draw, review deadline/escalation, calibration breach/top-up reminders, contract reserve/run, payout batches, stake exit/freeze expiry, retention deletion/export and reconciliation. Source requires self-hosted keepers plus independently callable money paths; queues must not be the only way workers can get paid.

Give every job a stable identity, bounded retry, recorded attempts and dead-letter handling. Alert on missed deadlines, reserve shortages, blocked payouts, stale oracle/configuration, ledger mismatch and indexer lag. Keep restricted task content and signer secrets out of logs. Test backup restore, signer/key rotation, provider failure and keeper restart. Resolve operational ownership with the team; no individuals or on-call service have been assigned in this package.

## 8. Configuration and interpretation decisions to resolve

The brief names Robinhood Chain 4663, USDG behavior, Permit2, account/EntryPoint, bundlers, RPC and gas assumptions. These are **source assertions, not verified live facts** in this handoff. Before the dependent milestone, record official evidence, date, environment, exact addresses/decimals/version, supported methods and test receipt. Do not guess addresses or deploy against a chain ID solely because it appears in a PDF.

Confirm chain/network availability, token behavior/decimals, Permit2 deployment/witness semantics, RPC history, bundler/Kernel/EntryPoint support, paymaster policy and gas caps; quote/attestor key management; reviewer governance/draw parameter/blockhash edge cases; review-reserve scaling; exact dispute hard-cap anchor; monetary rounding/finality; tier/volume/slash caps; issuer/market/oracle/pool settings and multiplier rules; sanctions/appeals retention handling; test metadata/signed capture/blur; Telegram rules; production font licenses. Optional routes remain off until their decisions are resolved.

## 9. Required launch demonstration

In staging: an authorized client posts screened items, receives independent calibration and a signed quote, funds the escrow, then the worker sees the listing. A second worker races the first claim and cannot take the same assignment. The owner submits valid work; client approval credits full pay once; default approval also works with Gigwork services stopped. Exercise dispute/default and refund boundaries. Show the pay statement and withdrawal receipt without changing the approved frontend.

For later milestones, prove funded-only gig starts and partial-work grace handling, rate consent and reserved-only contract settlement, failed stock leg -> USDG, independent history verification, and safe wind-down. Backend p. 10 specifically requires approveDefault, resolveDefault, refundUnclaimed, run, reserveNext, payoutBatch and withdraw with services stopped; fuzz no refunded submitted/disputed pay, no double Pay run, no reserved drain, no ordinary cancellation of started milestones, and delayed-draw unpredictability against a simulated sequencer. External review is required before batch/milestone/team caps rise above $5,000.

The six existing `pnpm test` cases test only frontend sample guards. They are not contract fuzz tests, an authorization audit, a provider integration suite or external security review. Add the backend/contract suites in the milestone that owns each invariant.

## 10. Operational scope and wind-down from Overview p. 6

These are source planning criteria, not instructions to execute an operational change during a frontend handoff. All metrics are cluster-filtered; implement reporting without displaying them as actual traction.

| Source checkpoint | Target / trigger | Source response if missed |
| --- | --- | --- |
| Day 14 | >=5,000 WorkerPasses; >=30% complete a paid task; >=2,000 paid assignments; >=25 paying requesters | Investigate causes, simplify onboarding, narrow to Judge/Verify |
| Day 30 | >=$20,000 paid to workers; realized median hourly rate >=floor | Keep the two best task types |
| Day 30, gigs | >=300 funded milestones; >=150 workers paid for gigs | Narrow to three best gig categories |
| Day 60 | >=40% repeat requesters; >=40 teams on Pay runs | Keep Pay runs as a feature, focus on tasks/gigs |
| Day 90 | <$50,000 monthly paid to workers | Orderly wind-down |

Wind-down stops new listings while in-progress work follows its normal protected path. Refund unclaimed batches, unstarted milestones and unreserved team balances on-chain; return stakes on schedule; return remaining bonus budget to treasury. Never use wind-down to drain reserved, submitted or disputed worker pay. Offline refunds/default approvals/Pay runs/withdrawals remain available. Source stake exit is 14 days with the single bounded fraud-review exception.

Before shipping public copy, retain Overview pp. 8–9 wording constraints: no stock ownership/named-stock hooks, free stocks, income/yield hype, employment/salary/payslip promises, guaranteed work, AI-boss/rent-a-human framing, investment advice, ordinary pay called rewards, or invented partnerships. Use pay statement, funded before listing, credited on approval, full listed pay and stock tokens where eligible. Date research and validate any exclusivity/category claim before use.
