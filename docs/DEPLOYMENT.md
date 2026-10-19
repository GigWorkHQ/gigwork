# Deployment and transfer

The ZIP contains the current website source and build, not the owner's hosting/account access. The owner's private URL can be used as a reference when access is separately granted. No sharing settings were changed for this delivery.

## Local and frontend hosting

The launcher serves `dist/` over loopback, supports nested routes and needs only Node. It is a local preview utility, not a production server. All runtime media/fonts are local. Source briefs, guides for developers and evidence remain outside `public`/`dist`.

Run `bun install --frozen-lockfile`, then `bun run build`. For local development, use `bun run dev`; deploy only `dist` with HTTPS and SPA fallback to `index.html`. Missing static assets should return 404. Check `/`, `/app/overview`, `/app/work`, `/app/work/WL-1049` and `/docs/getting-started` on a fresh browser. Never publish the source PDFs or environment files.

The portable ZIP omits `.openai/hosting.json` (the owner's Site binding), Git metadata and local plugin state. Local running/building need none of these. Use a separate deployment or explicitly granted access to the owner's hosting. Do not copy credentials into source.

## Backend environment inventory

Keep preview, staging and production explicit. Preview uses fixtures only. Staging has isolated accounts/databases/contracts/provider configuration. Live mode must not accept local balances or silently fall back to fixtures after failure. Keep the preview banner until integration claims are accurate.

The source stack is Bun/TypeScript, Hono+tRPC, Drizzle/Postgres (+ Timescale), BullMQ/Redis, viem and Foundry. Confirm supported versions and actual network/provider capability before provisioning it. No backend environment, Docker stack, migration or CI is installed in this handoff.

Proposed private configuration inventory: database/Redis URLs; object storage; allowed frontend origins; sessions; attestor signer references; RPC/bundler/paymaster secrets; verified network/token/contract addresses and decimals; reviewer-set/Safe governance; sanctions and policy providers; oracle/market-hours sources; route allow-lists; payout/gas caps. This is an inventory, not an implemented `.env` schema. Use managed server secrets and expose only deliberate public configuration.

## Release and recovery gates

- Enforce account/object ownership and prove it with separate accounts.
- Review migrations and rollbacks; test a backup restore.
- Reconcile receipts and reorgs; make jobs idempotent with bounded retries and dead-letter handling.
- Monitor deadlines, payout age, quote/funding mismatches and ledger differences; avoid sensitive content in logs.
- Pass original offline-call and fuzz invariants, with external review before relevant caps exceed $5,000.
- Resolve each enabled feature's unverified chain, issuer, account, Telegram and Local-task assumptions.
- Have the product owner confirm the intended deployment's notices, policy and font/asset rights.
- Compare against supplied screenshots and test phone/tablet/keyboard/reduced motion after integration.
