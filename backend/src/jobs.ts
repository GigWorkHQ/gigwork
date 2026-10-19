import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { PoolClient } from "pg";
import { formatUnits } from "viem";
import { z } from "zod";
import { requireAuth, requireTeam } from "./auth.js";
import { config, teamWallets } from "./config.js";
import { jobAssetSchema, parseUsdgAmount, usdgAmountSchema } from "./currency.js";
import { decryptPayload, encryptPayload, payloadDigest } from "./crypto.js";
import { db } from "./db/index.js";
import { assertCanDispute, assertCanRequestRevision, assertCanSubmit, assertClaimable, assertSettlementAllowed } from "./lifecycle.js";
import { makeEscrowWallet, verifyJobFunding, type FundingTerms, type JobAsset } from "./escrow.js";
import { ApiError, asyncRoute } from "./http.js";
import { processSettlement } from "./settlement.js";

export const jobsRouter = Router();
const uuid = z.string().uuid();
const createInput = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(20_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  asset: jobAssetSchema,
  amount: usdgAmountSchema,
});
const submissionInput = z.object({
  summary: z.string().trim().min(1).max(10_000),
  deliverable: z.string().trim().min(1).max(100_000),
  evidence: z.array(z.string().url().max(2_000)).max(20).default([]),
});

type JobRow = {
  id: string;
  client_id: string;
  client_wallet: string;
  doer_id: string | null;
  doer_wallet: string | null;
  title: string;
  description: string;
  acceptance_criteria: string[];
  asset: JobAsset;
  amount_raw: string;
  token_address: string;
  status: string;
  deadline_at: Date | null;
  funding_tx_hash: string | null;
  funding_block: string | null;
  active_submission_id: string | null;
  revision_count: number;
  escrow_address: string;
  created_at: Date;
  funded_at: Date | null;
  claimed_at: Date | null;
  submitted_at: Date | null;
  settled_at: Date | null;
};

const jobSelect = `SELECT j.*, c.wallet_address AS client_wallet, d.wallet_address AS doer_wallet,
    ew.address AS escrow_address
  FROM jobs j JOIN users c ON c.id=j.client_id
  LEFT JOIN users d ON d.id=j.doer_id
  JOIN job_escrow_wallets ew ON ew.job_id=j.id`;

function presentJob(job: JobRow) {
  return {
    id: job.id,
    clientWallet: job.client_wallet,
    doerWallet: job.doer_wallet,
    title: job.title,
    description: job.description,
    acceptanceCriteria: job.acceptance_criteria,
    asset: job.asset.toUpperCase(),
    amount: formatUnits(BigInt(job.amount_raw), config.USDG_DECIMALS),
    amountRaw: job.amount_raw,
    tokenAddress: job.token_address,
    status: job.status,
    deadlineAt: job.deadline_at,
    escrowAddress: job.escrow_address,
    fundingTransaction: job.funding_tx_hash,
    revisionCount: job.revision_count,
    createdAt: job.created_at,
    fundedAt: job.funded_at,
    claimedAt: job.claimed_at,
    submittedAt: job.submitted_at,
    settledAt: job.settled_at,
  };
}

async function appendEvent(
  client: { query: (text: string, values?: any[]) => Promise<any> },
  jobId: string,
  actorId: string | null,
  eventType: string,
  details: Record<string, unknown> = {},
) {
  await client.query(
    "INSERT INTO job_events (job_id,actor_id,event_type,details) VALUES ($1,$2,$3,$4)",
    [jobId, actorId, eventType, JSON.stringify(details)],
  );
}

jobsRouter.post(
  "/",
  requireAuth,
  asyncRoute(async (request, response) => {
    const input = createInput.parse(request.body);
    const amount = parseUsdgAmount(input.amount, config.USDG_DECIMALS);
    const id = randomUUID();
    const escrow = makeEscrowWallet(id);
    const deadlineAt = request.body?.deadlineAt ? new Date(request.body.deadlineAt) : null;
    if (deadlineAt && (!Number.isFinite(deadlineAt.getTime()) || deadlineAt <= new Date()))
      throw new ApiError(400, "invalid_deadline", "deadlineAt must be a valid future date.");

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO jobs (id,client_id,title,description,acceptance_criteria,asset,amount_raw,token_address,deadline_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          request.auth!.userId,
          input.title,
          input.description,
          JSON.stringify(input.acceptanceCriteria),
          input.asset,
          amount.toString(),
          config.USDG_TOKEN_ADDRESS.toLowerCase(),
          deadlineAt,
        ],
      );
      await client.query(
        "INSERT INTO job_escrow_wallets (job_id,address,encrypted_private_key) VALUES ($1,$2,$3)",
        [id, escrow.address, escrow.encryptedPrivateKey],
      );
      await appendEvent(client, id, request.auth!.userId, "job.created", {
        asset: input.asset,
        amountRaw: amount.toString(),
      });
      const created = await client.query<JobRow>(`${jobSelect} WHERE j.id=$1`, [id]);
      await client.query("COMMIT");
      response.status(201).json({ data: presentJob(created.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

jobsRouter.get(
  "/ready",
  asyncRoute(async (request, response) => {
    const page = z.coerce.number().int().min(1).max(10_000).default(1).parse(request.query.page);
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(request.query.limit);
    const result = await db.query<JobRow>(
      `${jobSelect} WHERE j.status='ready' ORDER BY j.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    );
    response.json({ data: result.rows.map(presentJob), page, limit });
  }),
);

jobsRouter.get(
  "/mine",
  requireAuth,
  asyncRoute(async (request, response) => {
    const result = await db.query<JobRow>(
      `${jobSelect} WHERE j.client_id=$1 OR j.doer_id=$1 ORDER BY j.updated_at DESC LIMIT 100`,
      [request.auth!.userId],
    );
    response.json({ data: result.rows.map(presentJob) });
  }),
);

jobsRouter.get(
  "/:id",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const result = await db.query<JobRow>(`${jobSelect} WHERE j.id=$1`, [id]);
    const job = result.rows[0];
    if (!job) throw new ApiError(404, "job_not_found", "This job does not exist.");
    const allowed =
      job.client_id === request.auth!.userId ||
      job.doer_id === request.auth!.userId ||
      teamWallets.has(request.auth!.walletAddress.toLowerCase());
    if (!allowed && job.status !== "ready")
      throw new ApiError(404, "job_not_found", "This job does not exist.");
    response.json({ data: presentJob(job) });
  }),
);

jobsRouter.post(
  "/:id/fund",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(request.body?.transactionHash);
    const job = await db.query<FundingTerms & { status: string }>(
      `SELECT j.id,j.asset,j.amount_raw::text,j.token_address,j.status,u.wallet_address AS client_wallet
       FROM jobs j JOIN users u ON u.id=j.client_id WHERE j.id=$1`,
      [id],
    );
    if (!job.rowCount) throw new ApiError(404, "job_not_found", "This job does not exist.");
    const terms = job.rows[0];
    if (terms.client_wallet.toLowerCase() !== request.auth!.walletAddress.toLowerCase())
      throw new ApiError(403, "client_only", "Only the job client can fund this job.");
    if (terms.status !== "awaiting_funding") {
      if (terms.status === "ready" && await fundingHashMatches(id, txHash)) {
        response.json({ data: { jobId: id, status: "ready", transactionHash: txHash }, idempotentReplay: true });
        return;
      }
      throw new ApiError(409, "job_not_fundable", "This job is not awaiting funding.");
    }
    const escrow = await db.query<{ address: string }>("SELECT address FROM job_escrow_wallets WHERE job_id=$1", [id]);
    const verified = await verifyJobFunding(terms, escrow.rows[0].address, txHash);

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: string; funding_tx_hash: string | null }>(
        "SELECT status,funding_tx_hash FROM jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      const current = locked.rows[0];
      if (current.status === "ready" && current.funding_tx_hash === txHash.toLowerCase()) {
        await client.query("COMMIT");
        response.json({ data: { jobId: id, status: "ready", transactionHash: txHash }, idempotentReplay: true });
        return;
      }
      if (current.status !== "awaiting_funding")
        throw new ApiError(409, "job_not_fundable", "This job is no longer awaiting funding.");
      await client.query(
        "UPDATE jobs SET status='ready',funding_tx_hash=$2,funding_block=$3,funded_at=now(),updated_at=now() WHERE id=$1",
        [id, verified.hash, verified.blockNumber],
      );
      await appendEvent(client, id, request.auth!.userId, "job.funded", {
        transactionHash: verified.hash,
        blockNumber: verified.blockNumber,
      });
      await client.query("COMMIT");
      response.json({ data: { jobId: id, status: "ready", transactionHash: verified.hash } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

async function fundingHashMatches(jobId: string, txHash: string) {
  const result = await db.query("SELECT 1 FROM jobs WHERE id=$1 AND funding_tx_hash=$2", [jobId, txHash.toLowerCase()]);
  return Boolean(result.rowCount);
}

jobsRouter.post(
  "/:id/claim",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: string; client_id: string; deadline_at: Date | null }>(
        "SELECT status,client_id,deadline_at FROM jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      const job = locked.rows[0];
      if (!job) throw new ApiError(404, "job_not_found", "This job does not exist.");
      assertClaimable(job, request.auth!.userId);
      await client.query("UPDATE jobs SET doer_id=$2,status='in_progress',claimed_at=now(),updated_at=now() WHERE id=$1", [
        id,
        request.auth!.userId,
      ]);
      await appendEvent(client, id, request.auth!.userId, "job.claimed");
      await client.query("COMMIT");
      response.json({ data: { jobId: id, status: "in_progress" } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

jobsRouter.post(
  "/:id/submissions",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const input = submissionInput.parse(request.body);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ status: string; doer_id: string | null }>(
        "SELECT status,doer_id FROM jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      const job = selected.rows[0];
      if (!job) throw new ApiError(404, "job_not_found", "This job does not exist.");
      assertCanSubmit(job, request.auth!.userId);
      const previous = await client.query<{ revision: number }>(
        "SELECT COALESCE(MAX(revision),0)::int AS revision FROM job_submissions WHERE job_id=$1",
        [id],
      );
      const revision = previous.rows[0].revision + 1;
      const payload = JSON.stringify(input);
      const inserted = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO job_submissions (job_id,submitted_by,revision,payload_ciphertext,payload_digest)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,created_at`,
        [id, request.auth!.userId, revision, encryptPayload(payload, `submission:${id}:${revision}`), payloadDigest(payload)],
      );
      await client.query(
        "UPDATE jobs SET status='submitted',active_submission_id=$2,submitted_at=now(),updated_at=now() WHERE id=$1",
        [id, inserted.rows[0].id],
      );
      await appendEvent(client, id, request.auth!.userId, "job.submitted", { submissionId: inserted.rows[0].id, revision });
      await client.query("COMMIT");
      response.status(201).json({ data: { id: inserted.rows[0].id, jobId: id, revision, submittedAt: inserted.rows[0].created_at } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

jobsRouter.get(
  "/:id/submissions",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const access = await db.query<{ client_id: string; doer_id: string | null }>(
      "SELECT client_id,doer_id FROM jobs WHERE id=$1",
      [id],
    );
    if (!access.rowCount) throw new ApiError(404, "job_not_found", "This job does not exist.");
    if (![access.rows[0].client_id, access.rows[0].doer_id].includes(request.auth!.userId))
      throw new ApiError(403, "job_forbidden", "Only the client and assigned doer can view submissions.");
    const rows = await db.query<{
      id: string;
      revision: number;
      payload_ciphertext: string;
      payload_digest: string;
      created_at: Date;
    }>("SELECT id,revision,payload_ciphertext,payload_digest,created_at FROM job_submissions WHERE job_id=$1 ORDER BY revision", [id]);
    response.json({
      data: rows.rows.map(({ payload_ciphertext, ...row }) => ({
        ...row,
        ...JSON.parse(decryptPayload(payload_ciphertext, `submission:${id}:${row.revision}`)),
      })),
    });
  }),
);

jobsRouter.post(
  "/:id/revisions",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const feedback = z.string().trim().min(1).max(10_000).parse(request.body?.feedback);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ client_id: string; status: string; active_submission_id: string | null }>(
        "SELECT client_id,status,active_submission_id FROM jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      const job = selected.rows[0];
      if (!job) throw new ApiError(404, "job_not_found", "This job does not exist.");
      assertCanRequestRevision(job, request.auth!.userId);
      const previousRevision = await client.query<{ revision: number }>(
        "SELECT revision FROM job_submissions WHERE id=$1",
        [job.active_submission_id],
      );
      const revisionNumber = previousRevision.rows[0].revision;
      await client.query(
        `INSERT INTO job_revisions (job_id,submission_id,requested_by,feedback_ciphertext,feedback_digest)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, job.active_submission_id, request.auth!.userId, encryptPayload(feedback, `revision:${id}:${revisionNumber}`), payloadDigest(feedback)],
      );
      await client.query("UPDATE jobs SET status='revision_requested',revision_count=revision_count+1,updated_at=now() WHERE id=$1", [id]);
      await appendEvent(client, id, request.auth!.userId, "job.revision_requested", { submissionId: job.active_submission_id, revision: revisionNumber });
      await client.query("COMMIT");
      response.json({ data: { jobId: id, status: "revision_requested" } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

jobsRouter.get(
  "/:id/revisions",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const access = await db.query<{ client_id: string; doer_id: string | null }>("SELECT client_id,doer_id FROM jobs WHERE id=$1", [id]);
    if (!access.rowCount) throw new ApiError(404, "job_not_found", "This job does not exist.");
    if (![access.rows[0].client_id, access.rows[0].doer_id].includes(request.auth!.userId))
      throw new ApiError(403, "job_forbidden", "Only the job participants can view revision requests.");
    const rows = await db.query<{ id: string; submission_id: string; feedback_ciphertext: string; feedback_digest: string; created_at: Date; revision: number }>(
      `SELECT r.id,r.submission_id,r.feedback_ciphertext,r.feedback_digest,r.created_at,s.revision
       FROM job_revisions r JOIN job_submissions s ON s.id=r.submission_id WHERE r.job_id=$1 ORDER BY r.created_at`,
      [id],
    );
    response.json({ data: rows.rows.map(({ feedback_ciphertext, revision, ...row }) => ({ ...row, revision, feedback: decryptPayload(feedback_ciphertext, `revision:${id}:${revision}`) })) });
  }),
);

jobsRouter.post(
  "/:id/accept",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const result = await createSettlement(id, request.auth!.userId, "client_acceptance", "pay_doer");
    response.status(202).json({ data: result });
    void processSettlement(id).catch((error) => console.error(`Settlement ${id} failed to start:`, error));
  }),
);

jobsRouter.post(
  "/:id/disputes",
  requireAuth,
  asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const reason = z.string().trim().min(1).max(10_000).parse(request.body?.reason);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ client_id: string; doer_id: string | null; status: string }>(
        "SELECT client_id,doer_id,status FROM jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      const job = selected.rows[0];
      if (!job) throw new ApiError(404, "job_not_found", "This job does not exist.");
      assertCanDispute(job, request.auth!.userId);
      await client.query(
        "INSERT INTO job_disputes (job_id,opened_by,reason_ciphertext,reason_digest) VALUES ($1,$2,$3,$4)",
        [id, request.auth!.userId, encryptPayload(reason, `dispute:${id}`), payloadDigest(reason)],
      );
      await client.query("UPDATE jobs SET status='disputed',updated_at=now() WHERE id=$1", [id]);
      await appendEvent(client, id, request.auth!.userId, "job.disputed");
      await client.query("COMMIT");
      response.status(201).json({ data: { jobId: id, status: "disputed" } });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

async function createSettlement(jobId: string, actorId: string, cause: string, outcome: "pay_doer" | "refund_client", existingClient?: PoolClient) {
  const client = existingClient ?? await db.connect();
  const ownsTransaction = !existingClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const result = await client.query<{ status: string; client_id: string; doer_id: string | null; amount_raw: string; client_wallet: string; doer_wallet: string | null }>(
      `SELECT j.status,j.client_id,j.doer_id,j.amount_raw::text,c.wallet_address AS client_wallet,d.wallet_address AS doer_wallet
       FROM jobs j JOIN users c ON c.id=j.client_id LEFT JOIN users d ON d.id=j.doer_id WHERE j.id=$1 FOR UPDATE OF j`,
      [jobId],
    );
    const job = result.rows[0];
    if (!job) throw new ApiError(404, "job_not_found", "This job does not exist.");
    assertSettlementAllowed(job, actorId, cause, outcome);
    const recipient = outcome === "pay_doer" ? job.doer_wallet! : job.client_wallet;
    await client.query("INSERT INTO job_settlements (job_id,outcome,recipient,amount_raw) VALUES ($1,$2,$3,$4)", [
      jobId,
      outcome,
      recipient.toLowerCase(),
      job.amount_raw,
    ]);
    await client.query("UPDATE jobs SET status='settlement_pending',updated_at=now() WHERE id=$1", [jobId]);
    await appendEvent(client, jobId, actorId, cause === "client_acceptance" ? "job.accepted" : "job.dispute_resolved", { outcome });
    if (ownsTransaction) await client.query("COMMIT");
    return { jobId, status: "settlement_pending", outcome };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export const teamJobsRouter = Router();
teamJobsRouter.use(requireAuth);
teamJobsRouter.use(requireTeam);

teamJobsRouter.get("/disputes", asyncRoute(async (_request, response) => {
  const result = await db.query(
    `${jobSelect} JOIN job_disputes jd ON jd.job_id=j.id
     WHERE j.status='disputed' ORDER BY jd.created_at ASC LIMIT 100`,
  );
  response.json({ data: result.rows.map(presentJob) });
}));

teamJobsRouter.get("/disputes/:jobId", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.jobId);
  const jobResult = await db.query<JobRow>(`${jobSelect} WHERE j.id=$1 AND j.status='disputed'`, [id]);
  const job = jobResult.rows[0];
  if (!job) throw new ApiError(404, "dispute_not_found", "This active dispute does not exist.");
  const [disputeResult, submissions, revisions, events] = await Promise.all([
    db.query<{ id: string; opened_by: string; reason_ciphertext: string; created_at: Date }>(
      "SELECT id,opened_by,reason_ciphertext,created_at FROM job_disputes WHERE job_id=$1", [id]),
    db.query<{ id: string; revision: number; payload_ciphertext: string; created_at: Date }>(
      "SELECT id,revision,payload_ciphertext,created_at FROM job_submissions WHERE job_id=$1 ORDER BY revision", [id]),
    db.query<{ id: string; submission_id: string; feedback_ciphertext: string; created_at: Date; revision: number }>(
      `SELECT r.id,r.submission_id,r.feedback_ciphertext,r.created_at,s.revision
       FROM job_revisions r JOIN job_submissions s ON s.id=r.submission_id WHERE r.job_id=$1 ORDER BY r.created_at`, [id]),
    db.query("SELECT event_type,details,created_at FROM job_events WHERE job_id=$1 ORDER BY id", [id]),
  ]);
  const dispute = disputeResult.rows[0];
  response.json({ data: {
    job: presentJob(job),
    dispute: { id: dispute.id, openedBy: dispute.opened_by, reason: decryptPayload(dispute.reason_ciphertext, `dispute:${id}`), createdAt: dispute.created_at },
    submissions: submissions.rows.map(({ payload_ciphertext, revision, ...row }) => ({ ...row, revision, ...JSON.parse(decryptPayload(payload_ciphertext, `submission:${id}:${revision}`)) })),
    revisions: revisions.rows.map(({ feedback_ciphertext, revision, ...row }) => ({ ...row, revision, feedback: decryptPayload(feedback_ciphertext, `revision:${id}:${revision}`) })),
    events: events.rows,
  } });
}));

teamJobsRouter.post("/disputes/:jobId/resolve", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.jobId);
  const input = z.object({ outcome: z.enum(["pay_doer", "refund_client"]), note: z.string().trim().min(1).max(10_000) }).parse(request.body);
  const client = await db.connect();
  let result: { jobId: string; status: string; outcome: string };
  try {
    await client.query("BEGIN");
    const dispute = await client.query<{ id: string }>("SELECT id FROM job_disputes WHERE job_id=$1 AND resolution IS NULL FOR UPDATE", [id]);
    if (!dispute.rowCount) throw new ApiError(409, "dispute_already_resolved", "This dispute is already resolved or does not exist.");
    result = await createSettlement(id, request.auth!.userId, "team_dispute_resolution", input.outcome, client);
    await client.query(
      `UPDATE job_disputes SET resolution=$2,resolution_note_ciphertext=$3,resolved_by=$4,resolved_at=now() WHERE job_id=$1`,
      [id, input.outcome, encryptPayload(input.note, `resolution:${id}`), request.auth!.userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  response.status(202).json({ data: result });
  void processSettlement(id).catch((error) => console.error(`Settlement ${id} failed to start:`, error));
}));

