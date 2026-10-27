import { advanceBatches } from "./batches.js";
import { runPayRuns } from "./contracts.js";
import { db } from "./db/index.js";
import { advanceGigs } from "./gigs.js";
import { advanceJobs } from "./jobs.js";
import { reconcileTransfers } from "./ledger.js";
import { advanceReviewCases } from "./reviews.js";
import { reconcileSettlements } from "./settlement.js";

// Time-driven steps: lease expiry, default approvals, expiry refunds, Pay runs, reviewer draws and payout
// retries. Every step is idempotent; the advisory lock only keeps two runs from overlapping.
const steps: Array<[string, () => Promise<void>]> = [
  ["jobs", advanceJobs],
  ["batches", advanceBatches],
  ["gigs", advanceGigs],
  ["pay runs", runPayRuns],
  ["review cases", advanceReviewCases],
  ["job settlements", reconcileSettlements],
  ["escrow transfers", reconcileTransfers],
];

export async function runKeeper() {
  const client = await db.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext('gigwork:keeper')) AS locked");
    if (!lock.rows[0].locked) return;
    try {
      for (const [name, step] of steps) {
        await step().catch((error) => console.error(`Keeper step "${name}" failed:`, error));
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('gigwork:keeper'))");
    }
  } finally {
    client.release();
  }
}
