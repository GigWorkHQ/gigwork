# GigWork

GigWork is a work marketplace paid in USDG on Robinhood Chain (mainnet, chain id 4663). Clients fund work into escrow before anyone starts. Workers are paid on-chain when the work is approved, or by default approval when a client goes quiet.

- **Jobs:** one task, one worker, one payout.
- **Quick tasks:** batches of small Judge / Verify / Label / Test items, posted from the web or by an AI agent with an API key.
- **Milestone gigs:** each milestone is funded before work on it starts.
- **Contracts:** recurring pay periods, reserved in escrow and paid by the keeper's Pay run when each period ends.
- Tips, pay handles, a shareable work history, referral bonuses, and disputes drawn at random to independent reviewers.

Live: [www.gigworkhq.com](https://www.gigworkhq.com). API: `https://gigwork-api-uhpj.onrender.com` (`/health`, `/health/ready`, `/health/ops`, `/v1/config`).

> **Escrow is custodial.** Each escrow is a wallet the API generates. Its key is encrypted with `DATA_ENCRYPTION_KEY` and stored in Postgres, and the API signs every payout and refund. Anyone holding that secret and the database could move escrowed funds. See [SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#threat-model) before trusting it with large amounts.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | React 19 + Vite frontend. Live screens are the `Live*.jsx` files; the rest is the marketing site and the sample-data preview. |
| `backend/src/` | Express 5 API on Bun: auth (SIWE), jobs, batches, gigs, contracts, reviews, ledger, keeper. |
| `backend/db/migrations/` | Ordered SQL migrations, applied automatically at startup and checksummed. |
| `backend/tests/` | Unit tests, plus `integration/` route and invariant tests against a real Postgres. |
| `docs/` | Architecture, runbook, and the original product handoff spec. |
| `.github/workflows/backend.yml` | CI: type-check, unit and Postgres tests, image build, deploy, and verification of the deployed commit. |

## Run it locally

Requires [Bun](https://bun.sh) 1.4.2 and Postgres 16.

```sh
# Frontend
bun install --frozen-lockfile
bun run dev            # http://127.0.0.1:5173 (set VITE_API_BASE_URL to point at your API)
bun run test
bun run build

# Backend
cd backend
bun install --frozen-lockfile
cp .env.example .env   # then fill in the values
bun run dev            # migrates the database, then serves on :3001
bun run check          # TypeScript
bun run test           # unit tests
DB_TESTS=1 bun run test  # also the route + invariant tests; DATABASE_URL must be a throwaway database (the schema is dropped)
```

## Deploy

- **Frontend:** Vercel builds from this repository and serves the SPA, with every path falling back to `index.html` (see `vercel.json`).
- **Backend:** each push to `main` runs CI. When CI passes, it builds the Docker image from `backend/Dockerfile`, publishes it to GHCR, triggers the Render deploy hook, and waits until `/health` reports the pushed commit and `/health/ready` passes. Migrations run at startup under an advisory lock.

Configuration is all environment variables, validated at boot by `backend/src/config.ts`; `backend/.env.example` documents each one. Never put a secret in a `VITE_*` variable: those are compiled into the public bundle.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Audit history and the fixes made are tracked in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#audit-history).

## License

Copyright © 2026 GigWork. All rights reserved. See [LICENSE](LICENSE).
