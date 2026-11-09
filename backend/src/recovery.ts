import { Router } from "express";
import { requireAuth, requireWalletSession } from "./auth.js";
import { fromRaw, uuid } from "./common.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";
import { escrowPosition, recoverSurplus, usdgBalance } from "./ledger.js";

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

recoveryRouter.get("/recoverable", asyncRoute(async (request, response) => {
  const userId = request.auth!.userId;
  const items: Array<Record<string, unknown>> = [];
  for (const escrow of await ownedEscrows(userId)) {
    const position = await escrowPosition(db, escrow.escrow_id, escrow.address).catch(() => null);
    if (position && position.surplus > 0n)
      items.push({ kind: escrow.kind, id: escrow.ref_id, escrowId: escrow.escrow_id, title: escrow.title, status: escrow.status, escrowAddress: escrow.address, amount: fromRaw(position.surplus), action: "recover" });
  }
  // Jobs use one wallet per job; an unfunded, cancelled or expired job's balance comes back through POST /v1/jobs/:id/cancel.
  const jobs = await db.query<{ id: string; title: string; status: string; address: string }>(
    `SELECT j.id,j.title,j.status,ew.address FROM jobs j JOIN job_escrow_wallets ew ON ew.job_id=j.id
     WHERE j.client_id=$1 AND j.status IN ('awaiting_funding','cancelled','expired')
       AND NOT EXISTS (SELECT 1 FROM job_settlements s WHERE s.job_id=j.id)
     ORDER BY j.created_at DESC LIMIT 100`,
    [userId],
  );
  for (const job of jobs.rows) {
    const balance = await usdgBalance(job.address).catch(() => 0n);
    // An awaiting-funding job with a balance is usually just waiting for its /fund call, so only flag the dead ends.
    if (balance > 0n && job.status !== "awaiting_funding")
      items.push({ kind: "job", id: job.id, title: job.title, status: job.status, escrowAddress: job.address, amount: fromRaw(balance), action: "cancel" });
  }
  response.json({ data: items });
}));

recoveryRouter.post("/escrows/:escrowId/recover", requireWalletSession, asyncRoute(async (request, response) => {
  const escrowId = uuid.parse(request.params.escrowId);
  const [owned] = await ownedEscrows(request.auth!.userId, escrowId);
  if (!owned) throw new ApiError(404, "escrow_not_found", "You have no escrow with this id.");
  const result = await recoverSurplus(escrowId, { userId: request.auth!.userId, wallet: request.auth!.walletAddress });
  response.status(202).json({ data: { recoveryId: result.recoveryId, amount: fromRaw(result.amountRaw), status: "sending" } });
}));
