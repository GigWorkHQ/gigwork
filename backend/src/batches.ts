import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { decryptPayload, encryptPayload, payloadDigest } from "./crypto.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";
import { amountInput, fromRaw, toRaw, uuid, withTransaction } from "./common.js";
import { createEscrowAccount, createTransfer, depositFor, kickEscrow, transfersFor, verifyDeposit } from "./ledger.js";
import { casesFor, openReviewCase, registerReviewSubject } from "./reviews.js";

// Quick tasks: a client (or an agent via API key) funds a batch of small items up front. Workers claim one
// item at a time under a short lease, submit, and are credited on approval or automatically when the
// review window passes without a rejection. Rejections can be taken to an external reviewer.

export const HOURLY_FLOOR_USDG = 6n;
const TASK_TYPES = ["judge", "verify", "label", "test", "other"] as const;
const IN_FLIGHT = ["claimed", "submitted", "rejected", "disputed"];

export function belowHourlyFloor(payRaw: bigint, minutes: number, decimals = config.USDG_DECIMALS) {
  return payRaw * 60n < HOURLY_FLOOR_USDG * 10n ** BigInt(decimals) * BigInt(minutes);
}

export function batchTotal(payRaw: bigint, items: number, workersPerItem: number) {
  return payRaw * BigInt(items) * BigInt(workersPerItem);
}

const itemInput = z.object({
  prompt: z.string().trim().min(1).max(5_000),
  options: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});
const createInput = z.object({
  title: z.string().trim().min(3).max(160),
  instructions: z.string().trim().min(20).max(20_000),
  taskType: z.enum(TASK_TYPES),
  pay: amountInput,
  minutes: z.number().int().min(1).max(240),
  workersPerItem: z.number().int().min(1).max(50).default(1),
  claimMinutes: z.number().int().min(2).max(240).default(10),
  reviewHours: z.number().int().min(24).max(336).default(24),
  durationDays: z.number().int().min(1).max(60).default(7),
  items: z.array(itemInput).min(1).max(1_000),
});
const answerInput = z.object({
  answer: z.string().trim().max(5_000).default(""),
  choice: z.string().trim().max(200).optional(),
});

type BatchRow = {
  id: string; client_id: string; escrow_id: string; source: string; task_type: string; title: string; instructions: string;
  pay_raw: string; minutes: number; items_count: number; workers_per_item: number; claim_minutes: number; review_hours: number;
  duration_days: number; total_raw: string; status: string; funded_at: Date | null; expires_at: Date | null; closed_at: Date | null;
  created_at: Date; escrow_address: string; client_wallet: string; client_handle: string | null; taken: string; credited: string;
  submitted: string;
};

const batchSelect = `SELECT b.*, b.pay_raw::text, b.total_raw::text, e.address AS escrow_address, u.wallet_address AS client_wallet, u.handle AS client_handle,
    (SELECT count(*) FROM assignments a WHERE a.batch_id=b.id AND a.status<>'released')::text AS taken,
    (SELECT count(*) FROM assignments a WHERE a.batch_id=b.id AND a.status='credited')::text AS credited,
    (SELECT count(*) FROM assignments a WHERE a.batch_id=b.id AND a.status='submitted')::text AS submitted
  FROM batches b JOIN escrow_accounts e ON e.id=b.escrow_id JOIN users u ON u.id=b.client_id`;

function presentBatch(row: BatchRow, viewerId?: string) {
  const slots = row.items_count * row.workers_per_item;
  const payRaw = BigInt(row.pay_raw);
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    taskType: row.task_type,
    source: row.source,
    client: row.client_handle ? `@${row.client_handle}` : row.client_wallet,
    clientWallet: row.client_wallet,
    isMine: viewerId === row.client_id,
    pay: fromRaw(payRaw),
    payRaw: payRaw.toString(),
    minutes: row.minutes,
    hourlyRate: (Number(fromRaw(payRaw)) * 60 / row.minutes).toFixed(2),
    itemsCount: row.items_count,
    workersPerItem: row.workers_per_item,
    slots,
    available: Math.max(0, slots - Number(row.taken)),
    credited: Number(row.credited),
    awaitingReview: Number(row.submitted),
    claimMinutes: row.claim_minutes,
    reviewHours: row.review_hours,
    durationDays: row.duration_days,
    total: fromRaw(row.total_raw),
    totalRaw: row.total_raw,
    tokenAddress: config.USDG_TOKEN_ADDRESS.toLowerCase(),
    escrowAddress: row.escrow_address,
    status: row.status,
    fundedAt: row.funded_at,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

async function loadBatch(id: string) {
  const result = await db.query<BatchRow>(`${batchSelect} WHERE b.id=$1`, [id]);
  if (!result.rowCount) throw new ApiError(404, "batch_not_found", "This batch does not exist.");
  return result.rows[0];
}

async function ownBatch(id: string, userId: string) {
  const row = await loadBatch(id);
  if (row.client_id !== userId) throw new ApiError(403, "client_only", "Only the client who posted this batch can do this.");
  return row;
}

async function creditAssignment(client: PoolClient, assignmentId: string, cause: "client_approval" | "default_approval" | "review_resolution") {
  const selected = await client.query<{ batch_id: string; escrow_id: string; pay_raw: string; worker_id: string; wallet_address: string }>(
    `SELECT a.batch_id,b.escrow_id,b.pay_raw::text,a.worker_id,u.wallet_address FROM assignments a
     JOIN batches b ON b.id=a.batch_id JOIN users u ON u.id=a.worker_id WHERE a.id=$1`,
    [assignmentId],
  );
  const row = selected.rows[0];
  await client.query(
    "UPDATE assignments SET status='credited',credited_at=now(),credit_cause=$2,updated_at=now() WHERE id=$1",
    [assignmentId, cause],
  );
  await createTransfer(client, {
    escrowId: row.escrow_id, kind: "assignment_pay", refId: assignmentId,
    recipientId: row.worker_id, recipient: row.wallet_address, amountRaw: row.pay_raw,
  });
  return row.escrow_id;
}

type AssignmentRow = {
  id: string; batch_id: string; item_id: string; worker_id: string; status: string; claimed_at: Date; lease_until: Date;
  submitted_at: Date | null; review_due_at: Date | null; answer_ciphertext: string | null; rejection_ciphertext: string | null;
  rejected_at: Date | null; dispute_due_at: Date | null; credited_at: Date | null; credit_cause: string | null;
  position: number; prompt: string; options: string[]; worker_wallet: string; worker_handle: string | null;
};
const assignmentSelect = `SELECT a.*, i.position, i.prompt, i.options, u.wallet_address AS worker_wallet, u.handle AS worker_handle
  FROM assignments a JOIN batch_items i ON i.id=a.item_id JOIN users u ON u.id=a.worker_id`;

function presentAssignment(row: AssignmentRow, { showWorker = false } = {}) {
  return {
    id: row.id,
    batchId: row.batch_id,
    itemPosition: row.position,
    prompt: row.prompt,
    options: row.options,
    status: row.status,
    claimedAt: row.claimed_at,
    leaseUntil: row.lease_until,
    submittedAt: row.submitted_at,
    reviewDueAt: row.review_due_at,
    rejectedAt: row.rejected_at,
    disputeDueAt: row.dispute_due_at,
    creditedAt: row.credited_at,
    creditCause: row.credit_cause,
    response: row.answer_ciphertext ? JSON.parse(decryptPayload(row.answer_ciphertext, `assignment:${row.id}`)) : null,
    rejectionReason: row.rejection_ciphertext ? decryptPayload(row.rejection_ciphertext, `assignment-rejection:${row.id}`) : null,
    // Requesters see a stable pseudonym per batch, not the worker's wallet.
    worker: showWorker ? (row.worker_handle ? `@${row.worker_handle}` : row.worker_wallet) : `worker-${payloadDigest(`${row.batch_id}:${row.worker_id}`).slice(0, 6)}`,
  };
}

export const batchesRouter = Router();
batchesRouter.use(requireAuth);

batchesRouter.post("/", asyncRoute(async (request, response) => {
  const input = createInput.parse(request.body);
  const payRaw = toRaw(input.pay);
  if (belowHourlyFloor(payRaw, input.minutes))
    throw new ApiError(400, "below_hourly_floor", `Pay must work out to at least ${HOURLY_FLOOR_USDG} USDG per hour for the estimated time.`);
  for (const item of input.items) {
    if (new Set(item.options).size !== item.options.length)
      throw new ApiError(400, "duplicate_options", "Each item's answer options must be distinct.");
  }
  const total = batchTotal(payRaw, input.items.length, input.workersPerItem);
  const id = await withTransaction(async (client) => {
    const escrow = await createEscrowAccount(client, "batch");
    const created = await client.query<{ id: string }>(
      `INSERT INTO batches (client_id,escrow_id,source,task_type,title,instructions,pay_raw,minutes,items_count,workers_per_item,
         claim_minutes,review_hours,duration_days,total_raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [request.auth!.userId, escrow.id, request.auth!.viaApiKey ? "agent" : "web", input.taskType, input.title, input.instructions,
        payRaw.toString(), input.minutes, input.items.length, input.workersPerItem, input.claimMinutes, input.reviewHours, input.durationDays, total.toString()],
    );
    const batchId = created.rows[0].id;
    for (const [index, item] of input.items.entries()) {
      await client.query("INSERT INTO batch_items (batch_id,position,prompt,options) VALUES ($1,$2,$3,$4)", [
        batchId, index + 1, item.prompt, JSON.stringify(item.options),
      ]);
    }
    return batchId;
  });
  response.status(201).json({ data: presentBatch(await loadBatch(id), request.auth!.userId) });
}));

batchesRouter.get("/mine", asyncRoute(async (request, response) => {
  const result = await db.query<BatchRow>(`${batchSelect} WHERE b.client_id=$1 ORDER BY b.created_at DESC LIMIT 100`, [request.auth!.userId]);
  response.json({ data: result.rows.map((row) => presentBatch(row, request.auth!.userId)) });
}));

batchesRouter.get("/:id", asyncRoute(async (request, response) => {
  const row = await loadBatch(uuid.parse(request.params.id));
  if (row.client_id !== request.auth!.userId && row.status !== "live")
    throw new ApiError(404, "batch_not_found", "This batch does not exist.");
  const refund = row.client_id === request.auth!.userId ? (await transfersFor([row.id])).get(row.id) ?? [] : [];
  response.json({ data: { ...presentBatch(row, request.auth!.userId), fundingTransaction: await depositFor("batch", row.id), refund } });
}));

batchesRouter.post("/:id/fund", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(request.body?.transactionHash);
  const batch = await ownBatch(id, request.auth!.userId);
  if (batch.status !== "awaiting_funding") {
    if ((await depositFor("batch", id)) === txHash.toLowerCase()) {
      response.json({ data: { batchId: id, status: batch.status }, idempotentReplay: true });
      return;
    }
    throw new ApiError(409, "batch_not_fundable", "This batch is not awaiting funding.");
  }
  await withTransaction(async (client) => {
    const locked = await client.query<{ status: string }>("SELECT status FROM batches WHERE id=$1 FOR UPDATE", [id]);
    if (locked.rows[0].status !== "awaiting_funding") throw new ApiError(409, "batch_not_fundable", "This batch is not awaiting funding.");
    await verifyDeposit(client, {
      escrowId: batch.escrow_id, escrowAddress: batch.escrow_address, purpose: "batch", refId: id,
      clientWallet: batch.client_wallet, amountRaw: batch.total_raw, txHash,
    });
    await client.query(
      `UPDATE batches SET status='live',funded_at=now(),expires_at=now()+make_interval(days => duration_days),updated_at=now() WHERE id=$1`,
      [id],
    );
  });
  response.json({ data: { batchId: id, status: "live" } });
}));

// Stop new claims. Work already claimed or submitted finishes normally; the unused balance is refunded
// once nothing is in flight.
batchesRouter.post("/:id/close", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  await ownBatch(id, request.auth!.userId);
  const result = await db.query<{ status: string }>(
    `UPDATE batches SET status=CASE status WHEN 'awaiting_funding' THEN 'cancelled' ELSE 'closing' END,
       closed_at=CASE status WHEN 'awaiting_funding' THEN now() ELSE closed_at END,updated_at=now()
     WHERE id=$1 AND status IN ('awaiting_funding','live') RETURNING status`,
    [id],
  );
  if (!result.rowCount) throw new ApiError(409, "batch_not_open", "This batch is already closed.");
  if (result.rows[0].status === "closing") await finalizeBatch(id);
  response.json({ data: { batchId: id, status: (await loadBatch(id)).status } });
}));

batchesRouter.get("/:id/submissions", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  await ownBatch(id, request.auth!.userId);
  const rows = await db.query<AssignmentRow>(
    `${assignmentSelect} WHERE a.batch_id=$1 AND a.status<>'released' ORDER BY i.position, a.claimed_at`,
    [id],
  );
  const reviews = await casesFor("assignment", rows.rows.map((row) => row.id));
  response.json({ data: rows.rows.map((row) => ({ ...presentAssignment(row), review: reviews.get(row.id) ?? null })) });
}));

batchesRouter.post("/:id/assignments/:assignmentId/approve", asyncRoute(async (request, response) => {
  const batchId = uuid.parse(request.params.id);
  const assignmentId = uuid.parse(request.params.assignmentId);
  await ownBatch(batchId, request.auth!.userId);
  const escrowId = await withTransaction(async (client) => {
    const locked = await client.query<{ status: string }>(
      "SELECT status FROM assignments WHERE id=$1 AND batch_id=$2 FOR UPDATE", [assignmentId, batchId]);
    if (locked.rows[0]?.status !== "submitted") throw new ApiError(409, "assignment_not_reviewable", "Only submitted work can be approved.");
    return creditAssignment(client, assignmentId, "client_approval");
  });
  kickEscrow(escrowId);
  response.json({ data: { assignmentId, status: "credited" } });
}));

batchesRouter.post("/:id/approve-all", asyncRoute(async (request, response) => {
  const batchId = uuid.parse(request.params.id);
  const batch = await ownBatch(batchId, request.auth!.userId);
  const count = await withTransaction(async (client) => {
    const pending = await client.query<{ id: string }>(
      "SELECT id FROM assignments WHERE batch_id=$1 AND status='submitted' FOR UPDATE", [batchId]);
    for (const row of pending.rows) await creditAssignment(client, row.id, "client_approval");
    return pending.rowCount ?? 0;
  });
  if (count) kickEscrow(batch.escrow_id);
  response.json({ data: { batchId, approved: count } });
}));

batchesRouter.post("/:id/assignments/:assignmentId/reject", asyncRoute(async (request, response) => {
  const batchId = uuid.parse(request.params.id);
  const assignmentId = uuid.parse(request.params.assignmentId);
  const reason = z.string().trim().min(10).max(5_000).parse(request.body?.reason);
  await ownBatch(batchId, request.auth!.userId);
  const updated = await db.query(
    `UPDATE assignments SET status='rejected',rejection_ciphertext=$3,rejected_at=now(),
       dispute_due_at=now()+make_interval(hours => $4),updated_at=now()
     WHERE id=$1 AND batch_id=$2 AND status='submitted' AND review_due_at>now()`,
    [assignmentId, batchId, encryptPayload(reason, `assignment-rejection:${assignmentId}`), config.DISPUTE_WINDOW_HOURS],
  );
  if (!updated.rowCount)
    throw new ApiError(409, "assignment_not_reviewable", "Only submitted work still inside its review window can be rejected.");
  response.json({ data: { assignmentId, status: "rejected" } });
}));

// Worker side.
export const tasksRouter = Router();

tasksRouter.get("/", asyncRoute(async (request, response) => {
  const type = z.enum(TASK_TYPES).optional().parse(request.query.type || undefined);
  const result = await db.query<BatchRow>(
    `${batchSelect} WHERE b.status='live' AND b.expires_at>now() ${type ? "AND b.task_type=$1" : ""} ORDER BY b.funded_at DESC LIMIT 100`,
    type ? [type] : [],
  );
  response.json({ data: result.rows.map((row) => presentBatch(row)).filter((batch) => batch.available > 0) });
}));

tasksRouter.use(requireAuth);

tasksRouter.get("/assignments", asyncRoute(async (request, response) => {
  const rows = await db.query<AssignmentRow & { title: string; pay_raw: string; task_type: string; instructions: string }>(
    `SELECT a.*, i.position, i.prompt, i.options, u.wallet_address AS worker_wallet, u.handle AS worker_handle,
       b.title, b.pay_raw::text, b.task_type, b.instructions
     FROM assignments a JOIN batch_items i ON i.id=a.item_id JOIN users u ON u.id=a.worker_id JOIN batches b ON b.id=a.batch_id
     WHERE a.worker_id=$1 AND a.status<>'released' ORDER BY a.updated_at DESC LIMIT 200`,
    [request.auth!.userId],
  );
  const payouts = await transfersFor(rows.rows.map((row) => row.id));
  const reviews = await casesFor("assignment", rows.rows.map((row) => row.id));
  response.json({ data: rows.rows.map((row) => ({
    ...presentAssignment(row, { showWorker: true }),
    title: row.title, taskType: row.task_type, instructions: row.instructions, pay: fromRaw(row.pay_raw),
    payout: payouts.get(row.id)?.[0] ?? null, review: reviews.get(row.id) ?? null,
  })) });
}));

tasksRouter.post("/:batchId/claim", asyncRoute(async (request, response) => {
  const batchId = uuid.parse(request.params.batchId);
  const assignmentId = await withTransaction(async (client) => {
    const batch = await client.query<{ client_id: string; status: string; expires_at: Date; workers_per_item: number; claim_minutes: number }>(
      "SELECT client_id,status,expires_at,workers_per_item,claim_minutes FROM batches WHERE id=$1 FOR UPDATE",
      [batchId],
    );
    const b = batch.rows[0];
    if (!b) throw new ApiError(404, "batch_not_found", "This batch does not exist.");
    if (b.client_id === request.auth!.userId) throw new ApiError(403, "client_cannot_claim", "You cannot claim tasks from your own batch.");
    if (b.status !== "live" || b.expires_at <= new Date()) throw new ApiError(409, "batch_not_live", "This batch is no longer taking claims.");
    const holding = await client.query(
      "SELECT 1 FROM assignments WHERE batch_id=$1 AND worker_id=$2 AND status='claimed' AND lease_until>now()",
      [batchId, request.auth!.userId],
    );
    if (holding.rowCount) throw new ApiError(409, "claim_in_progress", "Finish or release your current task in this batch first.");
    const item = await client.query<{ id: string }>(
      `SELECT i.id FROM batch_items i WHERE i.batch_id=$1
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.item_id=i.id AND a.worker_id=$2)
         AND (SELECT count(*) FROM assignments a WHERE a.item_id=i.id AND a.status<>'released') < $3
       ORDER BY i.position LIMIT 1`,
      [batchId, request.auth!.userId, b.workers_per_item],
    );
    if (!item.rowCount) throw new ApiError(409, "no_tasks_left", "There are no more tasks in this batch for you.");
    const created = await client.query<{ id: string }>(
      `INSERT INTO assignments (batch_id,item_id,worker_id,lease_until) VALUES ($1,$2,$3,now()+make_interval(mins => $4)) RETURNING id`,
      [batchId, item.rows[0].id, request.auth!.userId, b.claim_minutes],
    );
    return created.rows[0].id;
  });
  const row = await db.query<AssignmentRow>(`${assignmentSelect} WHERE a.id=$1`, [assignmentId]);
  response.status(201).json({ data: presentAssignment(row.rows[0], { showWorker: true }) });
}));

async function ownAssignment(client: PoolClient, id: string, userId: string) {
  const result = await client.query<{ status: string; worker_id: string; lease_until: Date; options: string[]; batch_id: string; client_id: string; dispute_due_at: Date | null; review_hours: number }>(
    `SELECT a.status,a.worker_id,a.lease_until,i.options,a.batch_id,b.client_id,a.dispute_due_at,b.review_hours FROM assignments a
     JOIN batch_items i ON i.id=a.item_id JOIN batches b ON b.id=a.batch_id WHERE a.id=$1 FOR UPDATE OF a`,
    [id],
  );
  const row = result.rows[0];
  if (!row || row.worker_id !== userId) throw new ApiError(404, "assignment_not_found", "This task assignment does not exist.");
  return row;
}

tasksRouter.post("/assignments/:id/submit", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const input = answerInput.parse(request.body);
  await withTransaction(async (client) => {
    const row = await ownAssignment(client, id, request.auth!.userId);
    if (row.status !== "claimed") throw new ApiError(409, "assignment_not_open", "This task is not open for submission.");
    if (row.lease_until <= new Date()) throw new ApiError(409, "claim_expired", "Your claim on this task expired. Claim a new task.");
    if (row.options.length && (!input.choice || !row.options.includes(input.choice)))
      throw new ApiError(400, "invalid_choice", "Choose one of the listed options.");
    if (!row.options.length && !input.answer) throw new ApiError(400, "answer_required", "Write your answer before submitting.");
    const payload = JSON.stringify({ answer: input.answer, choice: input.choice ?? null });
    await client.query(
      `UPDATE assignments SET status='submitted',submitted_at=now(),review_due_at=now()+make_interval(hours => $3),
         answer_ciphertext=$2,answer_digest=$4,updated_at=now() WHERE id=$1`,
      [id, encryptPayload(payload, `assignment:${id}`), row.review_hours, payloadDigest(payload)],
    );
  });
  response.json({ data: { assignmentId: id, status: "submitted" } });
}));

tasksRouter.post("/assignments/:id/release", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  await withTransaction(async (client) => {
    const row = await ownAssignment(client, id, request.auth!.userId);
    if (row.status !== "claimed") throw new ApiError(409, "assignment_not_open", "Only a claimed task can be released.");
    await client.query("UPDATE assignments SET status='released',updated_at=now() WHERE id=$1", [id]);
  });
  response.json({ data: { assignmentId: id, status: "released" } });
}));

tasksRouter.post("/assignments/:id/dispute", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const reason = z.string().trim().min(10).max(5_000).parse(request.body?.reason);
  await withTransaction(async (client) => {
    const row = await ownAssignment(client, id, request.auth!.userId);
    if (row.status !== "rejected" || !row.dispute_due_at || row.dispute_due_at <= new Date())
      throw new ApiError(409, "assignment_not_disputable", "Only a rejection inside its dispute window can be sent to review.");
    await client.query("UPDATE assignments SET status='disputed',updated_at=now() WHERE id=$1", [id]);
    await openReviewCase(client, { subjectKind: "assignment", subjectId: id, clientId: row.client_id, workerId: row.worker_id, openedBy: request.auth!.userId, reason });
  });
  response.status(201).json({ data: { assignmentId: id, status: "disputed" } });
}));

registerReviewSubject("assignment", {
  allowsSplit: false,
  async resolve(client, assignmentId, outcome) {
    const locked = await client.query<{ status: string }>("SELECT status FROM assignments WHERE id=$1 FOR UPDATE", [assignmentId]);
    if (locked.rows[0]?.status !== "disputed") throw new ApiError(409, "assignment_not_disputed", "This task is not in review.");
    if (outcome === "pay_worker") {
      const escrowId = await creditAssignment(client, assignmentId, "review_resolution");
      return () => kickEscrow(escrowId);
    }
    await client.query("UPDATE assignments SET status='rejected_final',updated_at=now() WHERE id=$1", [assignmentId]);
    return () => {};
  },
  async describe(assignmentId) {
    const row = (await db.query<AssignmentRow & { title: string; instructions: string; pay_raw: string; client_wallet: string }>(
      `SELECT a.*, i.position, i.prompt, i.options, u.wallet_address AS worker_wallet, u.handle AS worker_handle,
         b.title, b.instructions, b.pay_raw::text, c.wallet_address AS client_wallet
       FROM assignments a JOIN batch_items i ON i.id=a.item_id JOIN users u ON u.id=a.worker_id
       JOIN batches b ON b.id=a.batch_id JOIN users c ON c.id=b.client_id WHERE a.id=$1`,
      [assignmentId],
    )).rows[0];
    const view = presentAssignment(row, { showWorker: true });
    return {
      kind: "assignment", title: row.title, brief: row.instructions, prompt: row.prompt, options: row.options,
      amount: fromRaw(row.pay_raw), client: row.client_wallet, worker: view.worker,
      response: view.response, rejectionReason: view.rejectionReason, submittedAt: row.submitted_at,
    };
  },
});

async function finalizeBatch(batchId: string) {
  const escrowId = await withTransaction(async (client) => {
    const batch = await client.query<{ status: string; escrow_id: string; total_raw: string; pay_raw: string; client_id: string; wallet_address: string }>(
      `SELECT b.status,b.escrow_id,b.total_raw::text,b.pay_raw::text,b.client_id,u.wallet_address FROM batches b
       JOIN users u ON u.id=b.client_id WHERE b.id=$1 FOR UPDATE OF b`,
      [batchId],
    );
    const b = batch.rows[0];
    if (b?.status !== "closing") return null;
    const counts = await client.query<{ in_flight: string; credited: string }>(
      `SELECT count(*) FILTER (WHERE status=ANY($2))::text AS in_flight, count(*) FILTER (WHERE status='credited')::text AS credited
       FROM assignments WHERE batch_id=$1`,
      [batchId, IN_FLIGHT],
    );
    if (Number(counts.rows[0].in_flight) > 0) return null;
    const refund = BigInt(b.total_raw) - BigInt(b.pay_raw) * BigInt(counts.rows[0].credited);
    await client.query("UPDATE batches SET status='closed',closed_at=now(),updated_at=now() WHERE id=$1", [batchId]);
    const queued = await createTransfer(client, {
      escrowId: b.escrow_id, kind: "batch_refund", refId: batchId, recipientId: b.client_id, recipient: b.wallet_address, amountRaw: refund,
    });
    return queued ? b.escrow_id : null;
  });
  if (escrowId) kickEscrow(escrowId);
}

// Keeper step for quick tasks.
export async function advanceBatches() {
  await db.query("UPDATE assignments SET status='released',updated_at=now() WHERE status='claimed' AND lease_until<now()");
  const due = await db.query<{ id: string }>(
    "SELECT id FROM assignments WHERE status='submitted' AND review_due_at<now() ORDER BY review_due_at LIMIT 200",
  );
  const escrows = new Set<string>();
  for (const { id } of due.rows) {
    const escrowId = await withTransaction(async (client) => {
      const locked = await client.query<{ status: string }>("SELECT status FROM assignments WHERE id=$1 FOR UPDATE", [id]);
      return locked.rows[0]?.status === "submitted" ? creditAssignment(client, id, "default_approval") : null;
    });
    if (escrowId) escrows.add(escrowId);
  }
  for (const escrowId of escrows) kickEscrow(escrowId);
  await db.query("UPDATE assignments SET status='rejected_final',updated_at=now() WHERE status='rejected' AND dispute_due_at<now()");
  await db.query("UPDATE batches SET status='closing',updated_at=now() WHERE status='live' AND expires_at<now()");
  const closing = await db.query<{ id: string }>("SELECT id FROM batches WHERE status='closing' LIMIT 100");
  for (const { id } of closing.rows) await finalizeBatch(id);
}
