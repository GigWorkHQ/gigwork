import { formatEther, parseEther } from "viem";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { gasWalletAddress, publicClient } from "./escrow.js";

// Operating signals (audit L-3, D): the shared gas wallet pays every payout, so an empty one stalls them all.
export async function opsStatus() {
  const [balance, payouts] = await Promise.all([
    publicClient.getBalance({ address: gasWalletAddress }).catch(() => null),
    db.query<{ pending: string; failed: string; settlements_pending: string }>(
      `SELECT (SELECT count(*) FROM escrow_transfers WHERE status='pending')::text AS pending,
              (SELECT count(*) FROM escrow_transfers WHERE status='failed')::text AS failed,
              (SELECT count(*) FROM job_settlements WHERE status='pending')::text AS settlements_pending`,
    ),
  ]);
  const threshold = parseEther(config.GAS_ALERT_MIN_ETH);
  return {
    gasWallet: gasWalletAddress,
    gasBalanceEth: balance === null ? null : formatEther(balance),
    gasAlertBelowEth: config.GAS_ALERT_MIN_ETH,
    gasLow: balance === null ? null : balance < threshold,
    payoutsPending: Number(payouts.rows[0].pending) + Number(payouts.rows[0].settlements_pending),
    payoutsFailed: Number(payouts.rows[0].failed),
  };
}

let lastAlertAt = 0;
// Keeper step: post one alert an hour while the gas wallet is below its threshold or payouts have failed.
export async function checkOpsAlerts() {
  const status = await opsStatus();
  const problems: string[] = [];
  if (status.gasLow) problems.push(`gas wallet ${status.gasWallet} holds ${status.gasBalanceEth} ETH (alert below ${status.gasAlertBelowEth})`);
  if (status.payoutsFailed > 0) problems.push(`${status.payoutsFailed} escrow payout(s) failed and need a team retry`);
  if (!problems.length) return;
  if (Date.now() - lastAlertAt < 3_600_000) return;
  lastAlertAt = Date.now();
  console.warn(`[ops-alert] ${problems.join("; ")}`);
  if (!config.GAS_ALERT_WEBHOOK_URL) return;
  const text = `GigWork ops alert: ${problems.join("; ")}.`;
  await fetch(config.GAS_ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5_000),
  }).catch((error) => console.error("Ops alert webhook failed:", error));
}

// Keeper step: drop sign-in nonces that expired more than a day ago (audit L-2).
export async function sweepNonces() {
  await db.query("DELETE FROM auth_nonces WHERE expires_at < now() - interval '1 day'");
}
