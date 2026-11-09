import { Router } from "express";
import { requireAuth, requireWalletSession } from "./auth.js";
import { fromRaw, uuid, withTransaction } from "./common.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";
import { escrowPosition, jobEscrowAccount, recoverSurplus, usdgBalance } from "./ledger.js";
import { rateLimit } from "./ratelimit.js";

// Stuck-funds recovery (audit M-1, M-2). A client can see every escrow of theirs that holds USDG it does not owe
// anyone, and send that surplus back to their own wallet. Recorded deposits that still back open work are never touched.
export const recoveryRouter = Router();
recoveryRouter.use(requireAuth);

type OwnedEscrow = { escrow_id: string; address: string; kind: "batch" | "gig" | "contract"; ref_id: string; title: string; status: string };

async function ownedEscrows(userId: string, escrowId?: string) {
  const result = await db.query<OwnedEscrow>(
    `SELECT * FROM (
       SELECT e.id AS escrow_id,e.address,'batch' AS kind,b.id AS ref_id,b.title,b.status,b.created_at FROM batches b JOIN escrow_accounts e ON e.id=b.escrow_id WHERE b.client_id=$1
       UNION ALL
       SELECT e.id,e.address,'gig',g.id,g.title,g.status,g.created_at FROM gigs g JOIN escrow_accounts e ON e.id=g.escrow_id WHERE g.client_id=$1
       UNION ALL
       SELECT e.id,e.address,'contract',k.id,k.title,k.status,k.created_at FROM contracts k JOIN escrow_accounts e ON e.id=k.escrow_id WHERE k.client_id=$1
     ) owned WHERE ($2::uuid IS NULL OR escrow_id=$2::uuid) ORDER BY created_at DESC LIMIT 100`,
    [userId, escrowId ?? null],
  );
  return result.rows;
}

// The list reads a balance for every escrow a client owns, so it is rate limited and cached briefly (audit L-7):
// a signed-in user can't turn it into a flood of RPC calls that slows deposit checks and payouts for everyone.
const LIST_CACHE_MS = 30_000;
const listCache = new Map<string, { at: number; data: Array<Record<string, unknown>> }>();
const forget = (userId: string) => listCache.delete(userId);

async function recoverableFor(userId: string) {
  const items: Array<Record<string, unknown>> = [];
  for (const escrow of await ownedEscrows(userId)) {
    const position = await escrowPosition(db, escrow.escrow_id, escrow.address).catch(() => null);
    if (position && position.surplus > 0n)
      items.push({ kind: escrow.kind, id: escrow.ref_id, escrowId: escrow.escrow_id, title: escrow.title, status: escrow.status, escrowAddress: escrow.address, amount: fromRaw(position.surplus), action: "recover" });
  }
  // Jobs use one wallet per job.
  //  - Unfunded, cancelled or expired, never settled: the balance comes back through POST /v1/jobs/:id/cancel.
  //  - Paid out or refunded: anything still in the wallet was sent beyond the listed amount, and comes back through
  //    POST /v1/escrows/job/:jobId/recover (audit M-3).
  const jobs = await db.query<{ id: string; title: string; status: string; address: string; escrow_id: string | null }>(
    `SELECT j.id,j.title,j.status,ew.address,e.id AS escrow_id FROM jobs j
     JOIN job_escrow_wallets ew ON ew.job_id=j.id LEFT JOIN escrow_accounts e ON e.job_id=j.id
     WHERE j.client_id=$1 AND (
       (j.status IN ('awaiting_funding','cancelled','expired') AND NOT EXISTS (SELECT 1 FROM job_settlements s WHERE s.job_id=j.id))
       OR (j.status IN ('completed','refunded') AND EXISTS (SELECT 1 FROM job_settlements s WHERE s.job_id=j.id AND s.status='complete'))
     ) ORDER BY j.created_at DESC LIMIT 100`,
    [userId],
  );
  for (const job of jobs.rows) {
    if (job.status === "completed" || job.status === "refunded") {
      // Once registered, the wallet's surplus accounts for refunds already on their way.
      const amount = job.escrow_id
        ? await escrowPosition(db, job.escrow_id, job.address).then((p) => p.surplus).catch(() => 0n)
        : await usdgBalance(job.address).catch(() => 0n);
      if (amount > 0n) items.push({ kind: "job", id: job.id, title: job.title, status: job.status, escrowAddress: job.address, amount: fromRaw(amount), action: "recover_job" });
      continue;
    }
    const balance = await usdgBalance(job.address).catch(() => 0n);
    // An awaiting-funding job with a balance is usually just waiting for its /fund call, so only flag the dead ends.
    if (balance > 0n && job.status !== "awaiting_funding")
      items.push({ kind: "job", id: job.id, title: job.title, status: job.status, escrowAddress: job.address, amount: fromRaw(balance), action: "cancel" });
  }
  return items;
}

recoveryRouter.get("/recoverable", rateLimit({ name: "recovery check", perMinute: config.RATE_LIMIT_RECOVERY_PER_MINUTE }), asyncRoute(async (request, response) => {
  const userId = request.auth!.userId;
  const cached = listCache.get(userId);
  if (cached && Date.now() - cached.at < LIST_CACHE_MS) { response.json({ data: cached.data }); return; }
  const data = await recoverableFor(userId);
  listCache.set(userId, { at: Date.now(), data });
  if (listCache.size > 5_000) for (const [key, entry] of listCache) if (Date.now() - entry.at >= LIST_CACHE_MS) listCache.delete(key);
  response.json({ data });
}));

recoveryRouter.post("/escrows/job/:jobId/recover", requireWalletSession, asyncRoute(async (request, response) => {
  const jobId = uuid.parse(request.params.jobId);
  const escrowId = await withTransaction(async (client) => {
    const job = await client.query<{ client_id: string; status: string; settled: boolean }>(
      `SELECT j.client_id,j.status,EXISTS(SELECT 1 FROM job_settlements s WHERE s.job_id=j.id AND s.status='complete') AS settled
       FROM jobs j WHERE j.id=$1 FOR UPDATE`, [jobId]);
    if (!job.rowCount || job.rows[0].client_id !== request.auth!.userId) throw new ApiError(404, "job_not_found", "You have no job with this id.");
    if (!["completed", "refunded"].includes(job.rows[0].status) || !job.rows[0].settled)
      throw new ApiError(409, "job_not_settled", "Extra USDG can be recovered once this job's payout has finished. Unfunded or expired jobs are refunded through Cancel.");
    return jobEscrowAccount(client, jobId);
  });
  const result = await recoverSurplus(escrowId, { userId: request.auth!.userId, wallet: request.auth!.walletAddress });
  forget(request.auth!.userId);
  response.status(202).json({ data: { recoveryId: result.recoveryId, amount: fromRaw(result.amountRaw), status: "sending" } });
}));

recoveryRouter.post("/escrows/:escrowId/recover", requireWalletSession, asyncRoute(async (request, response) => {
  const escrowId = uuid.parse(request.params.escrowId);
  const [owned] = await ownedEscrows(request.auth!.userId, escrowId);
  if (!owned) throw new ApiError(404, "escrow_not_found", "You have no escrow with this id.");
  const result = await recoverSurplus(escrowId, { userId: request.auth!.userId, wallet: request.auth!.walletAddress });
  forget(request.auth!.userId);
  response.status(202).json({ data: { recoveryId: result.recoveryId, amount: fromRaw(result.amountRaw), status: "sending" } });
}));

// Job cancels change what is recoverable too; the jobs router calls this after a refund starts.
export const forgetRecoverable = forget;
