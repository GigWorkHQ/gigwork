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
| `android/` | GigWork for Android: an Expo / React Native companion app. It pairs to a web account with a one-time code and never holds a wallet. |
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

## Android companion app

The app is a companion to a web account. It doesn't create or hold a wallet:
1. Make your account on the web.
2. Open **Account → GigWork on your phone → Get a pairing code**.
3. Type the 8-character code into the app. It works once and expires in 10 minutes.

The phone then gets a device session for the same account, valid for 90 days. You can remove it from the same web panel at any time.

What it does:
- Find and claim work, submit, answer quick tasks, and decide reviewer cases.
- Approve and release, request changes, dispute, and respond to contract offers and rate changes.
- Follow pay and work history.

Anything that needs the wallet (posting new work, funding escrow, tips) opens that exact item on the web.

Builds follow Tera's Android flow (`.github/workflows/android.yml`):
- **Every push to `main` touching `android/`** builds a **GigWork Preview** APK (`com.gigworkhq.android.preview`), checks its package and signature, and publishes it with a version manifest to the `android-preview` GitHub release. The manifest includes the APK's SHA-256, computed in the same run.
- **Downloads and updates:** the web's **Download for Android** button goes through `GET /v1/mobile/android/download`. Installed apps check `GET /v1/mobile/android/manifest` and offer an in-app update. That update is only installed if the downloaded file's SHA-256 matches the manifest. Android always shows its own install screen.
- **A signed production app** (`com.gigworkhq.android`) is built by running the workflow manually with `signed_release=true`. That needs these Actions secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. It also needs the `ANDROID_RELEASE_CERT_SHA256` variable.

```sh
cd android
bun install --frozen-lockfile
bun run check && bun test tests
bun run export           # bundles the JavaScript, the same way the build does
bun run prebuild && (cd android && ./gradlew assembleRelease)   # local APK (needs JDK 17 and the Android SDK/NDK)
```

## Deploy

- **Frontend:** Vercel builds from this repository and serves the SPA, with every path falling back to `index.html` (see `vercel.json`).
- **Backend:** each push to `main` runs CI. When CI passes, it builds the Docker image from `backend/Dockerfile`, publishes it to GHCR, triggers the Render deploy hook, and waits until `/health` reports the pushed commit and `/health/ready` passes. Migrations run at startup under an advisory lock.

Configuration is all environment variables, validated at boot by `backend/src/config.ts`; `backend/.env.example` documents each one. Never put a secret in a `VITE_*` variable: those are compiled into the public bundle.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Audit history and the fixes made are tracked in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#audit-history).

## License

Copyright © 2026 GigWork. All rights reserved. See [LICENSE](LICENSE).
