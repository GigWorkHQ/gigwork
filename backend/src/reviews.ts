import { randomInt } from "node:crypto";
import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth, requireTeam } from "./auth.js";
import { config } from "./config.js";
import { decryptPayload, encryptPayload } from "./crypto.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";
import { resolveUser, uuid, withTransaction, type Queryable } from "./common.js";

// Review cases replace "the team decides everything": a rejected or disputed piece of work is drawn to a
// random external reviewer after a delay, who has a deadline. One redraw, then the team takes it.

export type SubjectKind = "job" | "assignment" | "milestone";
export type Outcome = "pay_worker" | "refund_client" | "split";
type Resolver = {
  // Applies the outcome inside the case's transaction and returns work to run after commit.
  resolve: (client: PoolClient, subjectId: string, outcome: Outcome, workerShareBps: number, actorId: string) => Promise<() => void>;
  // Everything a reviewer needs to decide: brief, submissions, history. Decrypted for authorized readers only.
  describe: (subjectId: string) => Promise<Record<string, unknown>>;
  allowsSplit: boolean;
};
const resolvers = new Map<SubjectKind, Resolver>();
export const registerReviewSubject = (kind: SubjectKind, resolver: Resolver) => resolvers.set(kind, resolver);

const reasonContext = (kind: string, id: string) => `review:${kind}:${id}`;

export async function openReviewCase(
  client: Queryable,
  input: { subjectKind: SubjectKind; subjectId: string; clientId: string; workerId: string; openedBy: string; reason: string },
) {
  try {
    await client.query(
      `INSERT INTO review_cases (subject_kind,subject_id,client_id,worker_id,opened_by,reason_ciphertext,draw_after)
       VALUES ($1,$2,$3,$4,$5,$6,now()+make_interval(mins => $7))`,
      [input.subjectKind, input.subjectId, input.clientId, input.workerId, input.openedBy,
        encryptPayload(input.reason, reasonContext(input.subjectKind, input.subjectId)), config.REVIEW_DRAW_DELAY_MINUTES],
    );
  } catch (error: any) {
    if (error?.code === "23505") throw new ApiError(409, "already_in_review", "This work has already been sent to review.");
    throw error;
  }
}

type CaseRow = {
  id: string; subject_kind: SubjectKind; subject_id: string; client_id: string; worker_id: string; opened_by: string;
  reason_ciphertext: string; status: string; reviewer_id: string | null; draw_after: Date; due_at: Date | null; draws: number;
  excluded_reviewers: string[];
  resolution: Outcome | null; worker_share_bps: number | null; note_ciphertext: string | null; resolved_at: Date | null; created_at: Date;
};

export function presentCase(row: CaseRow, viewerId?: string) {
  return {
    id: row.id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    status: row.status,
    openedByClient: row.opened_by === row.client_id,
    reviewerAssigned: Boolean(row.reviewer_id),
    youAreReviewer: Boolean(viewerId && row.reviewer_id === viewerId),
    drawAfter: row.draw_after,
    dueAt: row.due_at,
    draws: row.draws,
    resolution: row.resolution,
    workerShareBps: row.worker_share_bps,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export async function casesFor(kind: SubjectKind, ids: string[]) {
  if (!ids.length) return new Map<string, ReturnType<typeof presentCase>>();
  const result = await db.query<CaseRow>("SELECT * FROM review_cases WHERE subject_kind=$1 AND subject_id=ANY($2::uuid[])", [kind, ids]);
  return new Map(result.rows.map((row) => [row.subject_id, presentCase(row)]));
}

async function resolveCase(caseId: string, actorId: string, asTeam: boolean, input: { outcome: Outcome; workerShareBps?: number; note: string }) {
  let after: () => void = () => {};
  await withTransaction(async (client) => {
    const selected = await client.query<CaseRow>("SELECT * FROM review_cases WHERE id=$1 FOR UPDATE", [caseId]);
    const row = selected.rows[0];
    if (!row) throw new ApiError(404, "review_not_found", "This review case does not exist.");
    if (row.status === "resolved") throw new ApiError(409, "review_resolved", "This review case is already resolved.");
    if (!asTeam) {
      if (row.status !== "assigned" || row.reviewer_id !== actorId)
        throw new ApiError(403, "not_your_review", "This case is not assigned to you.");
      if (row.due_at && row.due_at < new Date())
        throw new ApiError(409, "review_deadline_passed", "Your review deadline has passed; the case is being reassigned.");
    }
    const resolver = resolvers.get(row.subject_kind)!;
    if (input.outcome === "split" && !resolver.allowsSplit)
      throw new ApiError(400, "split_not_supported", "Only milestone reviews can split the payment.");
    const share = input.outcome === "split" ? input.workerShareBps ?? -1 : input.outcome === "pay_worker" ? 10_000 : 0;
    if (input.outcome === "split" && (share < 1 || share > 9_999))
      throw new ApiError(400, "invalid_split", "A split must give the worker between 0.01% and 99.99%.");
    after = await resolver.resolve(client, row.subject_id, input.outcome, share, actorId);
    await client.query(
      `UPDATE review_cases SET status='resolved',resolution=$2,worker_share_bps=$3,note_ciphertext=$4,resolved_by=$5,resolved_at=now()
       WHERE id=$1`,
      [caseId, input.outcome, share, encryptPayload(input.note, `review-note:${caseId}`), actorId],
    );
  });
  after();
}

async function caseDetail(caseId: string, viewerId: string) {
  const selected = await db.query<CaseRow>("SELECT * FROM review_cases WHERE id=$1", [caseId]);
  const row = selected.rows[0];
  if (!row) throw new ApiError(404, "review_not_found", "This review case does not exist.");
  return {
    case: presentCase(row, viewerId),
    reason: decryptPayload(row.reason_ciphertext, reasonContext(row.subject_kind, row.subject_id)),
    note: row.note_ciphertext ? decryptPayload(row.note_ciphertext, `review-note:${caseId}`) : null,
    subject: await resolvers.get(row.subject_kind)!.describe(row.subject_id),
    allowsSplit: resolvers.get(row.subject_kind)!.allowsSplit,
  };
}

// Keeper step: draw reviewers for waiting cases and reassign or escalate overdue ones.
export async function advanceReviewCases() {
  const overdue = await db.query<CaseRow>("SELECT * FROM review_cases WHERE status='assigned' AND due_at<now() LIMIT 100");
  for (const row of overdue.rows) {
    await db.query(
      `UPDATE review_cases SET status=CASE WHEN draws<2 THEN 'waiting' ELSE 'escalated' END,
         reviewer_id=NULL,due_at=NULL,draw_after=now(),excluded_reviewers=array_append(excluded_reviewers,$2)
       WHERE id=$1 AND status='assigned'`,
      [row.id, row.reviewer_id],
    );
  }
  const waiting = await db.query<CaseRow>("SELECT * FROM review_cases WHERE status='waiting' AND draw_after<=now() ORDER BY draw_after LIMIT 100");
  for (const row of waiting.rows) {
    const candidates = await db.query<{ user_id: string }>(
      `SELECT r.user_id FROM reviewers r WHERE r.active AND r.user_id NOT IN ($1,$2)
       AND NOT (r.user_id = ANY($3::uuid[]))`,
      [row.client_id, row.worker_id, row.excluded_reviewers],
    );
    if (!candidates.rowCount) {
      await db.query("UPDATE review_cases SET status='escalated' WHERE id=$1 AND status='waiting'", [row.id]);
      continue;
    }
    // Drawn only after the delay, with a CSPRNG, so neither party can pick the reviewer when they act.
    const reviewer = candidates.rows[randomInt(candidates.rows.length)].user_id;
    await db.query(
      `UPDATE review_cases SET status='assigned',reviewer_id=$2,draws=draws+1,due_at=now()+make_interval(hours => $3)
       WHERE id=$1 AND status='waiting'`,
      [row.id, reviewer, config.REVIEW_DEADLINE_HOURS],
    );
  }
}

const resolveInput = z.object({
  outcome: z.enum(["pay_worker", "refund_client", "split"]),
  workerShareBps: z.number().int().min(0).max(10_000).optional(),
  note: z.string().trim().min(1).max(10_000),
});

export const reviewsRouter = Router();
reviewsRouter.use(requireAuth);

reviewsRouter.get("/me", asyncRoute(async (request, response) => {
  const reviewer = await db.query<{ active: boolean }>("SELECT active FROM reviewers WHERE user_id=$1", [request.auth!.userId]);
  const assigned = await db.query<CaseRow>(
    "SELECT * FROM review_cases WHERE reviewer_id=$1 AND status='assigned' ORDER BY due_at",
    [request.auth!.userId],
  );
  const resolved = await db.query<{ count: string }>(
    "SELECT count(*)::text FROM review_cases WHERE resolved_by=$1",
    [request.auth!.userId],
  );
  response.json({ data: {
    isReviewer: Boolean(reviewer.rows[0]?.active),
    assigned: assigned.rows.map((row) => presentCase(row, request.auth!.userId)),
    resolvedCount: Number(resolved.rows[0].count),
  } });
}));

reviewsRouter.get("/:id", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const owner = await db.query<{ reviewer_id: string | null; status: string }>("SELECT reviewer_id,status FROM review_cases WHERE id=$1", [id]);
  if (owner.rows[0]?.reviewer_id !== request.auth!.userId || owner.rows[0]?.status !== "assigned")
    throw new ApiError(404, "review_not_found", "This review case is not assigned to you.");
  response.json({ data: await caseDetail(id, request.auth!.userId) });
}));

reviewsRouter.post("/:id/resolve", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  await resolveCase(id, request.auth!.userId, false, resolveInput.parse(request.body));
  response.status(202).json({ data: { id, status: "resolved" } });
}));

export const teamReviewsRouter = Router();
teamReviewsRouter.use(requireAuth, requireTeam);

teamReviewsRouter.get("/reviews", asyncRoute(async (request, response) => {
  const result = await db.query<CaseRow>(
    `SELECT * FROM review_cases WHERE status<>'resolved'
     ORDER BY CASE status WHEN 'escalated' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END, created_at LIMIT 200`,
  );
  response.json({ data: result.rows.map((row) => presentCase(row, request.auth!.userId)) });
}));

teamReviewsRouter.get("/reviews/:id", asyncRoute(async (request, response) => {
  response.json({ data: await caseDetail(uuid.parse(request.params.id), request.auth!.userId) });
}));

teamReviewsRouter.post("/reviews/:id/resolve", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  await resolveCase(id, request.auth!.userId, true, resolveInput.parse(request.body));
  response.status(202).json({ data: { id, status: "resolved" } });
}));

teamReviewsRouter.get("/reviewers", asyncRoute(async (_request, response) => {
  const result = await db.query<{ user_id: string; wallet_address: string; handle: string | null; active: boolean; created_at: Date; resolved: string; assigned: string }>(
    `SELECT r.user_id,u.wallet_address,u.handle,r.active,r.created_at,
       (SELECT count(*) FROM review_cases c WHERE c.resolved_by=r.user_id)::text AS resolved,
       (SELECT count(*) FROM review_cases c WHERE c.reviewer_id=r.user_id AND c.status='assigned')::text AS assigned
     FROM reviewers r JOIN users u ON u.id=r.user_id ORDER BY r.created_at`,
  );
  response.json({ data: result.rows.map((row) => ({
    userId: row.user_id, wallet: row.wallet_address, handle: row.handle ? `@${row.handle}` : null,
    active: row.active, addedAt: row.created_at, resolved: Number(row.resolved), assigned: Number(row.assigned),
  })) });
}));

teamReviewsRouter.post("/reviewers", asyncRoute(async (request, response) => {
  const reference = z.string().trim().min(1).max(64).parse(request.body?.user);
  const user = await resolveUser(db, reference);
  await db.query(
    `INSERT INTO reviewers (user_id,added_by) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET active=true`,
    [user.id, request.auth!.userId],
  );
  response.status(201).json({ data: { userId: user.id, wallet: user.wallet_address, active: true } });
}));

teamReviewsRouter.post("/reviewers/:userId/deactivate", asyncRoute(async (request, response) => {
  const userId = uuid.parse(request.params.userId);
  await db.query("UPDATE reviewers SET active=false WHERE user_id=$1", [userId]);
  // Unassign open cases so they are redrawn rather than waiting on an inactive reviewer.
  await db.query(
    `UPDATE review_cases SET status='waiting',reviewer_id=NULL,due_at=NULL,draw_after=now(),excluded_reviewers=array_append(excluded_reviewers,$1)
     WHERE reviewer_id=$1 AND status='assigned'`,
    [userId],
  );
  response.json({ data: { userId, active: false } });
}));
