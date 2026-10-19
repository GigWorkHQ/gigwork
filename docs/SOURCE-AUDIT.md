# Gigwork source audit and transfer boundary

Reviewed against all 10 pages of `source/Workloom Backend.pdf` and all 9 pages of `source/Workloom Overview.pdf`, prepared 16 October 2026. The user renamed the website to Gigwork on 18 October. Original PDFs and extracted page-marked text retain their original wording; the new name does not authorize changing monetary requirements or inventing a ticker.

This is an audit of the **frontend handoff and requirement coverage**, not certification of an implemented backend. No live backend exists. The detailed implementation map distinguishes Required / Current / Proposed / Unresolved. Page numbers here are one-based PDF pages.

## Backend: all pages accounted for

| Pages | Source contents checked | Destination / remaining work |
| --- | --- | --- |
| 1 | Bun/TS, Hono+tRPC, Drizzle/Postgres/Timescale, BullMQ/Redis, viem, Dwellir; Foundry/Solidity; Kernel/passkeys/backup signer; chain/Permit2/gas assumptions; architecture | BACKEND-IMPLEMENTATION §§1, 3, 8; DEPLOYMENT. All server/contract/provider work remains. Source claims about chain availability and providers are not independently verified by this handoff. |
| 2 | Batch fields and every-entry-point policy; personal-data/seed-phrase field restrictions | BACKEND-IMPLEMENTATION §§3–5. Live screening, schema validation and human report queue remain. |
| 3 | Sandbox/synthetic accounts, redaction, independent p65 calibration, $6 floor, 3-day top-up; paid/random/rotated tests; <80% last-50 pause; appeals/agreement/format/capture | BACKEND-IMPLEMENTATION §§4–5. Frontend has sample guards, not independent calibration or a quality service. |
| 4 | Exact TaskEscrow interface; 24h review; expiry bound; lock submitted pay; delayed draw, 72h resolution, one escalation/144h hard cap; fees/reserve; initial GigEscrow methods | BACKEND-IMPLEMENTATION §4, M1/M7. Preserve original interfaces. Confirm hard-cap anchor and delayed blockhash handling before implementation. |
| 5 | Remaining GigEscrow interface, partial split, consented extensions, deadline+72h; PayRuns team threshold, offer/accept, reserve/run/stream, future rate, notice, unreserved withdraw | BACKEND-IMPLEMENTATION §4, FRONTEND-INTEGRATION. Most lifecycle paths need real commands and supporting UI states. |
| 6 | PayoutRouter exact-input route/fallback, elections/tips; WorkHistory commitment/reveal; separate fixed-budget BonusVault; tier/attestation limits | BACKEND-IMPLEMENTATION §§4–6, M2/M9/M10. Holdings, tips, claims, public reveal and account onboarding remain. |
| 7 | Stake exit/freeze/slash; screening; fingerprint retention; Local privacy; skip/report; exact Permit2; atomic x402 batch-hash witness; client stock-to-USDG funding | BACKEND-IMPLEMENTATION §§4–8. Client funding and worker payout are opposite swap directions and must not share the wrong routing assumptions. |
| 8 | Exact source database fields; content/fingerprint/payment retention; red-team boundaries and public requester rejection rate | BACKEND-IMPLEMENTATION §§5–7. Use original schema as the starting requirement, proposed additions clearly marked. |
| 9 | Remaining abuse cases; original M1–M11 build order and estimated durations | BACKEND-IMPLEMENTATION §2. No backend milestone is represented as implemented or accepted by this frontend delivery. |
| 10 | Services-offline money paths; five fuzz properties; external review before caps >$5,000; centralized attestors/reviewers, sequencer/device/capture/Telegram limits | BACKEND-IMPLEMENTATION §§8–9 and DEPLOYMENT. Existing six frontend tests do not satisfy these release gates. |

## Overview: all pages accounted for

| Pages | Source contents checked | Destination / decision |
| --- | --- | --- |
| 1–2 | Product identity; working ticker; dated market research/unverified category claim; quick/agent/gig/contract/Local scope | Website sections, BUILD-MAP and implementation scope. Dated research is not live traction. Gigwork is the user's current brand; ticker/name availability is not verified. |
| 3 | Passkey start/skills; pay estimates; 10 sponsored withdrawals/month, ≤6h payout; default-zero stock risk consent/fallback; holdings/handles/history/tips | Implementation M2/M5/M9/M10; missing production surfaces below. No 60-second onboarding performance claim has been tested. |
| 4 | $3 to each referral participant, 10 explicitly approved tasks, accuracy/7 days; first five +50%; fixed budget/caps; client funding; silence/default and review/cancel rules | BACKEND-IMPLEMENTATION §4. Bonus amounts and caps are requirements/proposals, not funded promises. |
| 5 | 12%/8%/1% capped $15 client fees; no worker/tip fee; route costs only; proposed $20k bonus budget; utility discount ≤3 points; 80/10/5/5 split | BACKEND-IMPLEMENTATION §4. Formula interaction and launch budget require explicit configuration before use. Launch scripts/scenarios are not customer testimonials. |
| 6 | Day 14/30/60/90 decision metrics and orderly wind-down | Implementation §10 below. Operational planning, not instructions to trigger actions in this delivery. |
| 7 | Adults/independent work/taxes; estimated floor; screening exceptions; centralized trust; public payout/history privacy; issuer eligibility and Telegram uncertainty | BACKEND-IMPLEMENTATION §5/§8; public safety/privacy/terms guides. Requires jurisdiction/issuer decisions before launch. |
| 8 | Forbidden work and wording/claims; Local risk; chain/issuer risk | Implementation §5 and public guides. No invented partnerships, guaranteed work, stock ownership or employment promises. |
| 9 | Preferred product wording; W1–W8 roadmap; research-source list | Website roadmap and implementation milestones. Dates are source plans, not delivery guarantees. |

## Concrete remaining product surfaces

Keep the existing design while adding these within their milestone: real passkey/recovery and WorkerPass/stake actions; live quotes/funding/signature/receipt/error states; worker-owned assignments and private content; requester/reviewer authorization and delayed-draw/escalation views; full gig invitation/acceptance/progress/extension/partial-work handling; team/admin thresholds, offers, period reservation, stream and notice settlement; payout destination/receipts, real holdings and tips; scoped agent keys/results; public selected-history reveal; BonusVault claims; permitted Telegram and Local clients.

The current sample omits some lifecycle controls intentionally because it has no server/contract integration. It is not a complete production UI for every backend method. The route and handler map identifies what already exists, so the developer can extend those screens without replacing them.

Known sample limitation: `taskAction` can report generic success after an invalid transition was caught in its state updater. FRONTEND-INTEGRATION documents the exact seam to replace with an awaited command result. Other sample limits include static availability counts, browser timers, decimal JS amounts, trusted role/tier/country controls and local-only history. These are explicit M5 integration acceptance items, not proof of live correctness.

## Source ambiguities to resolve at the dependent milestone

- M1: separate the `k` assignment count from delayed-draw block delay; confirm the 144h hard-cap anchor, missing/expired blockhash behavior, no-draw timeout and reviewer reserve sizing.
- M2: numeric tier volume/accuracy limits and slash caps are not all supplied. Genuine-device attestation must not be represented as unique-person verification.
- M5/M8: rounding/base units, fee discounts against the 1% capped Pay run fee, current-period streamed amounts in notice settlement, chain finality and replay rules need concrete reviewed definitions.
- M7: the GigEscrow interface comments name `approveDefault`, but do not list it as a separate signature. Resolve the callable API while retaining the required anyone-after-window behavior.
- M9: the client route is called an exact-output swap while the source describes a min-out bound; define the input-cost protection precisely. Do not copy the worker exact-input payout implementation unchanged.
- Provider/network, token/address/decimal, Permit2 prerequisite approvals, issuer eligibility, oracle/pool/multiplier, sanctions/legal retention, Telegram, signed capture and font rights remain unresolved as listed in BACKEND-IMPLEMENTATION §8.
- No new Gigwork utility ticker is approved. The original `$WLOOM` working ticker remains historical source material.

When resolving these, record the decision, source/evidence, date, owner and tests. Do not silently change the original PDFs or fill missing values with fixture numbers.
