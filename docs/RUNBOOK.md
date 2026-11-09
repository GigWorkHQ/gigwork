# Operations runbook

## What to watch

| Signal | Where | Normal | Act when |
| --- | --- | --- | --- |
| Deployed commit | `GET /health` → `commit` | Matches `main` | It differs after a deploy finishes |
| Database | `GET /health/ready` | `{"status":"ready"}` | Anything else |
| Gas wallet | `GET /health/ops` → `gasBalanceEth`, `gasLow` | `gasLow: false` | `gasLow: true` |
| Payout backlog | `GET /health/ops` → `payoutsPending` | Falls to 0 within minutes | It keeps growing for 10+ minutes |
| Failed payouts | `GET /health/ops` → `payoutsFailed` | 0 | Above 0 |
| Alerts | `GAS_ALERT_WEBHOOK_URL` channel, and `[ops-alert]` lines in the Render logs | Silent | Any message (sent at most once an hour) |

## Gas wallet low

Payouts pause; no funds are lost.

1. Send ETH on Robinhood Chain to the gas wallet in `GET /v1/config` → `gasWallet`. Each payout uses well under 0.0001 ETH; keep at least 0.002 ETH.
2. Within a minute or two, the keeper resumes pending payouts. Watch `payoutsPending` fall.

## A payout failed

A transfer reverted, usually because the token issuer froze the recipient, or the escrow is short.

1. Team console → **Failed payouts**. Read the error.
2. Fix the cause: check the recipient on the explorer, and check the escrow's USDG balance.
3. Click **Retry**. The transfer is signed again to the same recipient and amount, and the retry is logged.

Job payouts are in the same queue (kind `job pay` or `job refund`). A job payout that reverts stops there instead of retrying. Its job page tells both parties that the funds are safe in escrow while the team fixes the cause.

## A client says their USDG is stuck

1. Ask them to open **Account → Recover stuck USDG**. It lists every escrow of theirs that holds money it doesn't owe anyone, including USDG sent to a job beyond its amount once the job has paid out, and returns it with one click. The list is cached for 30 seconds.
2. If nothing is listed, the money is backing open work, for example a live batch or a reserved pay period. That is returned through the normal flow: close the batch, cancel the milestone, or let the contract period end.

## A deploy went wrong

1. Render → the service → **Rollback** to the previous image. Every image is tagged with its commit SHA in GHCR.
2. Migrations are forward-only and run at startup. Never edit an applied migration file: the migrator refuses to start if a checksum changes. Fix forward with a new migration.

## Suspected key or database compromise

1. Rotate `AUTH_TOKEN_PEPPER` right away. This signs everyone out.
2. Stop the service (Render → Suspend) to stop all signing.
3. **Do not rotate `DATA_ENCRYPTION_KEY` in place.** Existing escrow keys are encrypted under it. Start a fresh deployment with a new key, then move balances out of the old escrows to their rightful parties with the old key, offline.
4. Move the gas wallet's remaining ETH to a new wallet and set `GAS_WALLET_PRIVATE_KEY`.
5. Publish a note on what happened, and add it to the audit history in `docs/ARCHITECTURE.md`.

## Team wallet changes

Team wallets are the comma list `TEAM_WALLET_ADDRESSES`. Adding or removing one is a redeploy. Every bonus approval, payout retry, reviewer change and team ruling is in **Team → Action log** (`GET /v1/team/actions`).
