import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { decryptPayload, encryptPayload } from "./crypto.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";
import { amountInput, fromRaw, party, resolveUser, toRaw, uuid, withTransaction, type Queryable } from "./common.js";
import { createEscrowAccount, createTransfer, kickEscrow, transfersFor, verifyDeposit } from "./ledger.js";
import { casesFor, openReviewCase, registerReviewSubject } from "./reviews.js";

// Milestone gigs: a gig lists once its first milestone is funded, and every milestone is funded before the
// worker starts it. Started milestones cannot be cancelled except on the overdue path; disputes go to review,
// which may split a milestone between worker and client.

const OVERDUE_GRACE_HOURS = 72;
const ACTIVE = ["in_progress", "submitted", "revision_requested", "disputed"];
const FINAL = ["approved", "refunded", "split", "cancelled"];

const milestoneInput = z.object({
  title: z.string().trim().min(1).max(160),
  amount: amountInput,
  dueDays: z.number().int().min(1).max(365).optional(),
});
const createInput = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(20_000),
  category: z.string().trim().min(1).max(60),
  reviewHours: z.number().int().min(72).max(336).default(72),
  worker: z.string().trim().max(64).optional(),
  milestones: z.array(milestoneInput).min(1).max(20),
});
const deliveryInput = z.object({
  summary: z.string().trim().min(1).max(10_000),
  deliverable: z.string().trim().min(1).max(100_000),
  evidence: z.array(z.string().url().max(2_000)).max(20).default([]),
});

type GigRow = {
  id: string; client_id: string; worker_id: string | null; invited_worker_id: string | null; escrow_id: string; title: string;
  description: string; category: string; review_hours: number; status: string; accepted_at: Date | null; created_at: Date;
  escrow_address: string; client_wallet: string; client_handle: string | null; worker_wallet: string | null; worker_handle: string | null;
  invited_wallet: string | null; invited_handle: string | null;
};
type MilestoneRow = {
  id: string; gig_id: string; position: number; title: string; amount_raw: string; due_days: number | null; status: string;
  funded_at: Date | null; started_at: Date | null; due_at: Date | null; submitted_at: Date | null; review_due_at: Date | null;
  revision_count: number; delivery_ciphertext: string | null; approved_at: Date | null; resolved_at: Date | null;
};

const gigSelect = `SELECT g.*, e.address AS escrow_address, c.wallet_address AS client_wallet, c.handle AS client_handle,
    w.wallet_address AS worker_wallet, w.handle AS worker_handle, i.wallet_address AS invited_wallet, i.handle AS invited_handle
  FROM gigs g JOIN escrow_accounts e ON e.id=g.escrow_id JOIN users c ON c.id=g.client_id
  LEFT JOIN users w ON w.id=g.worker_id LEFT JOIN users i ON i.id=g.invited_worker_id`;

type Thread = Array<{ type: "submission"; summary: string; deliverable: string; evidence: string[]; at: string } | { type: "feedback"; text: string; at: string }>;
const readThread = (row: { id: string; delivery_ciphertext: string | null }): Thread =>
  row.delivery_ciphertext ? JSON.parse(decryptPayload(row.delivery_ciphertext, `milestone:${row.id}`)) : [];
const writeThread = (id: string, thread: Thread) => encryptPayload(JSON.stringify(thread), `milestone:${id}`);

function roleOf(gig: GigRow, userId?: string) {
  if (!userId) return null;
  if (gig.client_id === userId) return "client";
  if (gig.worker_id === userId) return "worker";
  if (gig.invited_worker_id === userId) return "invited";
  return null;
}

async function presentGig(gig: GigRow, viewerId?: string) {
  const role = roleOf(gig, viewerId);
  const milestones = await db.query<MilestoneRow>("SELECT *, amount_raw::text FROM milestones WHERE gig_id=$1 ORDER BY position", [gig.id]);
  const ids = milestones.rows.map((m) => m.id);
  const [payouts, reviews, deposits] = await Promise.all([
    transfersFor(ids),
    casesFor("milestone", ids),
    db.query<{ ref_id: string; tx_hash: string }>("SELECT ref_id,tx_hash FROM escrow_deposits WHERE purpose='milestone' AND ref_id=ANY($1::uuid[])", [ids]),
  ]);
  const funding = new Map(deposits.rows.map((row) => [row.ref_id, row.tx_hash]));
  const participant = role === "client" || role === "worker";
  const total = milestones.rows.reduce((sum, m) => sum + BigInt(m.amount_raw), 0n);
  return {
    id: gig.id,
    title: gig.title,
    description: gig.description,
    category: gig.category,
    reviewHours: gig.review_hours,
    status: gig.status,
    role,
    client: party(gig.client_wallet, gig.client_handle),
    worker: party(gig.worker_wallet, gig.worker_handle),
    invited: participant || role === "invited" ? party(gig.invited_wallet, gig.invited_handle) : null,
    escrowAddress: gig.escrow_address,
    tokenAddress: config.USDG_TOKEN_ADDRESS.toLowerCase(),
    total: fromRaw(total),
    acceptedAt: gig.accepted_at,
    createdAt: gig.created_at,
    milestones: milestones.rows.map((m) => ({
      id: m.id,
      position: m.position,
      title: m.title,
      amount: fromRaw(m.amount_raw),
      amountRaw: m.amount_raw,
      dueDays: m.due_days,
      status: m.status,
      fundedAt: m.funded_at,
      fundingTransaction: funding.get(m.id) ?? null,
      startedAt: m.started_at,
      dueAt: m.due_at,
      submittedAt: m.submitted_at,
      reviewDueAt: m.review_due_at,
      revisionCount: m.revision_count,
      approvedAt: m.approved_at,
      payouts: payouts.get(m.id) ?? [],
      review: reviews.get(m.id) ?? null,
      thread: participant ? readThread(m) : undefined,
    })),
  };
}

async function loadGig(id: string, client: Queryable = db, lock = false) {
  const result = await client.query<GigRow>(`${gigSelect} WHERE g.id=$1${lock ? " FOR UPDATE OF g" : ""}`, [id]);
  if (!result.rowCount) throw new ApiError(404, "gig_not_found", "This gig does not exist.");
  return result.rows[0];
}

async function lockMilestone(client: PoolClient, gigId: string, milestoneId: string) {
  const result = await client.query<MilestoneRow>(
    "SELECT *, amount_raw::text FROM milestones WHERE id=$1 AND gig_id=$2 FOR UPDATE",
    [milestoneId, gigId],
  );
  if (!result.rowCount) throw new ApiError(404, "milestone_not_found", "This milestone does not exist.");
  return result.rows[0];
}

async function refreshGigStatus(client: Queryable, gigId: string) {
  const states = await client.query<{ status: string }>("SELECT status FROM milestones WHERE gig_id=$1", [gigId]);
  const all = states.rows.map((row) => row.status);
  if (!all.every((status) => FINAL.includes(status))) return;
  const paid = all.some((status) => status === "approved" || status === "split");
  await client.query(
    "UPDATE gigs SET status=$2,updated_at=now() WHERE id=$1 AND status NOT IN ('completed','cancelled')",
    [gigId, paid ? "completed" : "cancelled"],
  );
}

async function payMilestone(client: PoolClient, gig: GigRow, milestone: MilestoneRow, workerShareBps: number) {
  const amount = BigInt(milestone.amount_raw);
  const toWorker = (amount * BigInt(workerShareBps)) / 10_000n;
  const toClient = amount - toWorker;
  if (toWorker > 0n)
    await createTransfer(client, { escrowId: gig.escrow_id, kind: "milestone_pay", refId: milestone.id, recipientId: gig.worker_id, recipient: gig.worker_wallet!, amountRaw: toWorker });
  if (toClient > 0n)
    await createTransfer(client, { escrowId: gig.escrow_id, kind: "milestone_refund", refId: milestone.id, recipientId: gig.client_id, recipient: gig.client_wallet, amountRaw: toClient });
  const status = toClient === 0n ? "approved" : toWorker === 0n ? "refunded" : "split";
  await client.query(
    `UPDATE milestones SET status=$2,approved_at=CASE WHEN $2='approved' THEN now() ELSE approved_at END,resolved_at=now(),updated_at=now() WHERE id=$1`,
    [milestone.id, status],
  );
  await refreshGigStatus(client, gig.id);
}

export const gigsRouter = Router();

gigsRouter.get("/open", asyncRoute(async (_request, response) => {
  const result = await db.query<GigRow>(
    `${gigSelect} WHERE g.status='open' AND g.invited_worker_id IS NULL ORDER BY g.updated_at DESC LIMIT 100`,
  );
  response.json({ data: await Promise.all(result.rows.map((gig) => presentGig(gig))) });
}));

gigsRouter.use(requireAuth);

gigsRouter.post("/", asyncRoute(async (request, response) => {
  const input = createInput.parse(request.body);
  const amounts = input.milestones.map((m) => toRaw(m.amount));
  const id = await withTransaction(async (client) => {
    const invited = input.worker ? await resolveUser(client, input.worker) : null;
    if (invited?.id === request.auth!.userId) throw new ApiError(400, "cannot_invite_self", "You cannot invite yourself.");
    const escrow = await createEscrowAccount(client, "gig");
    const created = await client.query<{ id: string }>(
      `INSERT INTO gigs (client_id,invited_worker_id,escrow_id,title,description,category,review_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [request.auth!.userId, invited?.id ?? null, escrow.id, input.title, input.description, input.category, input.reviewHours],
    );
    for (const [index, milestone] of input.milestones.entries()) {
      await client.query(
        "INSERT INTO milestones (gig_id,position,title,amount_raw,due_days) VALUES ($1,$2,$3,$4,$5)",
        [created.rows[0].id, index + 1, milestone.title, amounts[index].toString(), milestone.dueDays ?? null],
      );
    }
    return created.rows[0].id;
  });
  response.status(201).json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.get("/mine", asyncRoute(async (request, response) => {
  const result = await db.query<GigRow>(
    `${gigSelect} WHERE g.client_id=$1 OR g.worker_id=$1 OR (g.invited_worker_id=$1 AND g.status='open')
     ORDER BY g.updated_at DESC LIMIT 100`,
    [request.auth!.userId],
  );
  response.json({ data: await Promise.all(result.rows.map((gig) => presentGig(gig, request.auth!.userId))) });
}));

gigsRouter.get("/:id", asyncRoute(async (request, response) => {
  const gig = await loadGig(uuid.parse(request.params.id));
  const role = roleOf(gig, request.auth!.userId);
  if (!role && !(gig.status === "open" && !gig.invited_worker_id)) throw new ApiError(404, "gig_not_found", "This gig does not exist.");
  response.json({ data: await presentGig(gig, request.auth!.userId) });
}));

gigsRouter.post("/:id/invite", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const reference = z.string().trim().max(64).nullable().parse(request.body?.worker ?? null);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can invite a worker.");
    if (!["draft", "open"].includes(gig.status)) throw new ApiError(409, "gig_not_open", "This gig already has a worker.");
    const invited = reference ? await resolveUser(client, reference) : null;
    if (invited?.id === gig.client_id) throw new ApiError(400, "cannot_invite_self", "You cannot invite yourself.");
    await client.query("UPDATE gigs SET invited_worker_id=$2,updated_at=now() WHERE id=$1", [id, invited?.id ?? null]);
  });
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/accept", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id === request.auth!.userId) throw new ApiError(403, "client_cannot_accept", "You cannot accept your own gig.");
    if (gig.status !== "open") throw new ApiError(409, "gig_not_open", "This gig is not open for acceptance.");
    if (gig.invited_worker_id && gig.invited_worker_id !== request.auth!.userId)
      throw new ApiError(403, "invite_only", "This gig was offered to someone else.");
    await client.query(
      "UPDATE gigs SET worker_id=$2,invited_worker_id=NULL,status='active',accepted_at=now(),updated_at=now() WHERE id=$1",
      [id, request.auth!.userId],
    );
  });
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/milestones/:milestoneId/fund", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(request.body?.transactionHash);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can fund milestones.");
    if (["completed", "cancelled"].includes(gig.status)) throw new ApiError(409, "gig_closed", "This gig is closed.");
    const milestone = await lockMilestone(client, id, milestoneId);
    if (milestone.status !== "unfunded") throw new ApiError(409, "milestone_not_fundable", "This milestone is not awaiting funding.");
    await verifyDeposit(client, {
      escrowId: gig.escrow_id, escrowAddress: gig.escrow_address, purpose: "milestone", refId: milestoneId,
      clientWallet: gig.client_wallet, amountRaw: milestone.amount_raw, txHash,
    });
    await client.query("UPDATE milestones SET status='funded',funded_at=now(),updated_at=now() WHERE id=$1", [milestoneId]);
    await client.query("UPDATE gigs SET status='open',updated_at=now() WHERE id=$1 AND status='draft'", [id]);
  });
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/milestones/:milestoneId/start", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.worker_id !== request.auth!.userId) throw new ApiError(403, "worker_only", "Only the gig's worker can start a milestone.");
    if (gig.status !== "active") throw new ApiError(409, "gig_not_active", "This gig is not active.");
    const milestone = await lockMilestone(client, id, milestoneId);
    if (milestone.status !== "funded") throw new ApiError(409, "milestone_not_funded", "A milestone must be funded before you start it.");
    const busy = await client.query("SELECT 1 FROM milestones WHERE gig_id=$1 AND status=ANY($2)", [id, ACTIVE]);
    if (busy.rowCount) throw new ApiError(409, "milestone_in_progress", "Finish the milestone in progress before starting another.");
    await client.query(
      `UPDATE milestones SET status='in_progress',started_at=now(),
         due_at=CASE WHEN due_days IS NULL THEN NULL ELSE now()+make_interval(days => due_days) END,updated_at=now() WHERE id=$1`,
      [milestoneId],
    );
  });
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/milestones/:milestoneId/submit", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  const input = deliveryInput.parse(request.body);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.worker_id !== request.auth!.userId) throw new ApiError(403, "worker_only", "Only the gig's worker can submit work.");
    const milestone = await lockMilestone(client, id, milestoneId);
    if (!["in_progress", "revision_requested"].includes(milestone.status))
      throw new ApiError(409, "milestone_not_submittable", "This milestone is not accepting a submission.");
    const thread = [...readThread(milestone), { type: "submission" as const, ...input, at: new Date().toISOString() }];
    await client.query(
      `UPDATE milestones SET status='submitted',submitted_at=now(),review_due_at=now()+make_interval(hours => $3),
         delivery_ciphertext=$2,updated_at=now() WHERE id=$1`,
      [milestoneId, writeThread(milestoneId, thread), gig.review_hours],
    );
  });
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/milestones/:milestoneId/revision", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  const feedback = z.string().trim().min(1).max(10_000).parse(request.body?.feedback);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can request changes.");
    const milestone = await lockMilestone(client, id, milestoneId);
    if (milestone.status !== "submitted") throw new ApiError(409, "milestone_not_reviewable", "Only submitted work can be sent back.");
    const thread = [...readThread(milestone), { type: "feedback" as const, text: feedback, at: new Date().toISOString() }];
    await client.query(
      `UPDATE milestones SET status='revision_requested',revision_count=revision_count+1,review_due_at=NULL,
         delivery_ciphertext=$2,updated_at=now() WHERE id=$1`,
      [milestoneId, writeThread(milestoneId, thread)],
    );
  });
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/milestones/:milestoneId/approve", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  const gig = await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can approve work.");
    const milestone = await lockMilestone(client, id, milestoneId);
    if (milestone.status !== "submitted") throw new ApiError(409, "milestone_not_reviewable", "Only submitted work can be approved.");
    await payMilestone(client, gig, milestone, 10_000);
    return gig;
  });
  kickEscrow(gig.escrow_id);
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

gigsRouter.post("/:id/milestones/:milestoneId/dispute", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  const reason = z.string().trim().min(10).max(10_000).parse(request.body?.reason);
  await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (![gig.client_id, gig.worker_id].includes(request.auth!.userId))
      throw new ApiError(403, "gig_forbidden", "Only the gig's client or worker can open a dispute.");
    const milestone = await lockMilestone(client, id, milestoneId);
    if (!["in_progress", "submitted", "revision_requested"].includes(milestone.status))
      throw new ApiError(409, "milestone_not_disputable", "This milestone cannot be disputed in its current state.");
    await client.query("UPDATE milestones SET status='disputed',review_due_at=NULL,updated_at=now() WHERE id=$1", [milestoneId]);
    await openReviewCase(client, { subjectKind: "milestone", subjectId: milestoneId, clientId: gig.client_id, workerId: gig.worker_id!, openedBy: request.auth!.userId, reason });
  });
  response.status(201).json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

// Cancel one milestone: unfunded ones simply close; funded-but-unstarted ones refund; a started milestone
// only refunds when it is 72 hours past its due date and nothing was ever submitted.
gigsRouter.post("/:id/milestones/:milestoneId/cancel", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const milestoneId = uuid.parse(request.params.milestoneId);
  const gig = await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can cancel a milestone.");
    const milestone = await lockMilestone(client, id, milestoneId);
    await cancelMilestone(client, gig, milestone);
    await refreshGigStatus(client, id);
    return gig;
  });
  kickEscrow(gig.escrow_id);
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

export function milestoneCancellable(m: Pick<MilestoneRow, "status" | "due_at" | "submitted_at">, now = new Date()) {
  if (m.status === "unfunded" || m.status === "funded") return true;
  return m.status === "in_progress" && !m.submitted_at && Boolean(m.due_at) &&
    m.due_at!.getTime() + OVERDUE_GRACE_HOURS * 3_600_000 <= now.getTime();
}

async function cancelMilestone(client: PoolClient, gig: GigRow, milestone: MilestoneRow) {
  if (!milestoneCancellable(milestone))
    throw new ApiError(409, "milestone_not_cancellable", "Started milestones can only be cancelled 72 hours after their due date with no submission.");
  if (milestone.status === "unfunded") {
    await client.query("UPDATE milestones SET status='cancelled',resolved_at=now(),updated_at=now() WHERE id=$1", [milestone.id]);
    return;
  }
  await payMilestone(client, gig, milestone, 0);
}

gigsRouter.post("/:id/cancel", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const gig = await withTransaction(async (client) => {
    const gig = await loadGig(id, client, true);
    if (gig.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can cancel this gig.");
    const milestones = await client.query<MilestoneRow>("SELECT *, amount_raw::text FROM milestones WHERE gig_id=$1 FOR UPDATE", [id]);
    const open = milestones.rows.filter((m) => !FINAL.includes(m.status));
    if (open.some((m) => !["unfunded", "funded"].includes(m.status)))
      throw new ApiError(409, "gig_has_started_work", "Finish, resolve or cancel the started milestone first.");
    for (const milestone of open) await cancelMilestone(client, gig, milestone);
    await refreshGigStatus(client, id);
    return gig;
  });
  kickEscrow(gig.escrow_id);
  response.json({ data: await presentGig(await loadGig(id), request.auth!.userId) });
}));

registerReviewSubject("milestone", {
  allowsSplit: true,
  async resolve(client, milestoneId, _outcome, workerShareBps) {
    const row = await client.query<{ gig_id: string }>("SELECT gig_id FROM milestones WHERE id=$1", [milestoneId]);
    const gig = await loadGig(row.rows[0].gig_id, client, true);
    const milestone = await lockMilestone(client, gig.id, milestoneId);
    if (milestone.status !== "disputed") throw new ApiError(409, "milestone_not_disputed", "This milestone is not in review.");
    await payMilestone(client, gig, milestone, workerShareBps);
    return () => kickEscrow(gig.escrow_id);
  },
  async describe(milestoneId) {
    const milestone = (await db.query<MilestoneRow>("SELECT *, amount_raw::text FROM milestones WHERE id=$1", [milestoneId])).rows[0];
    const gig = await loadGig(milestone.gig_id);
    return {
      kind: "milestone", title: `${gig.title} — ${milestone.title}`, brief: gig.description, amount: fromRaw(milestone.amount_raw),
      client: gig.client_handle ? `@${gig.client_handle}` : gig.client_wallet,
      worker: gig.worker_handle ? `@${gig.worker_handle}` : gig.worker_wallet,
      escrowAddress: gig.escrow_address, dueAt: milestone.due_at, startedAt: milestone.started_at, thread: readThread(milestone),
    };
  },
});

// Keeper step: default approval for milestones whose review window passed without a response.
export async function advanceGigs() {
  const due = await db.query<{ id: string; gig_id: string }>(
    "SELECT id,gig_id FROM milestones WHERE status='submitted' AND review_due_at<now() LIMIT 100",
  );
  for (const row of due.rows) {
    const escrowId = await withTransaction(async (client) => {
      const gig = await loadGig(row.gig_id, client, true);
      const milestone = await lockMilestone(client, row.gig_id, row.id);
      if (milestone.status !== "submitted" || !milestone.review_due_at || milestone.review_due_at > new Date()) return null;
      await payMilestone(client, gig, milestone, 10_000);
      return gig.escrow_id;
    });
    if (escrowId) kickEscrow(escrowId);
  }
}
