import { ApiError } from "./http.js";

type ClaimableJob = { client_id: string; status: string; deadline_at: Date | null };
type SubmissionJob = { doer_id: string | null; status: string };
type ReviewJob = { client_id: string; status: string; active_submission_id: string | null };
type DisputableJob = { client_id: string; doer_id: string | null; status: string };
type SettlementJob = {
  client_id: string;
  doer_id: string | null;
  doer_wallet: string | null;
  status: string;
  deadline_at?: Date | null;
  active_submission_id?: string | null;
};

export const OVERDUE_GRACE_MS = 72 * 3_600_000;

// A claimed job whose deadline passed more than 72 hours ago with nothing submitted can be cancelled.
export function isOverdueWithoutSubmission(job: Pick<SettlementJob, "status" | "deadline_at" | "active_submission_id">, now = new Date()) {
  return job.status === "in_progress" && !job.active_submission_id && Boolean(job.deadline_at) &&
    job.deadline_at!.getTime() + OVERDUE_GRACE_MS <= now.getTime();
}

export function assertClaimable(job: ClaimableJob, actorId: string, now = new Date()) {
  if (job.client_id === actorId)
    throw new ApiError(403, "client_cannot_claim", "The client cannot claim their own job.");
  if (job.status !== "ready")
    throw new ApiError(409, "job_not_claimable", "This job is no longer ready to claim.");
  if (job.deadline_at && job.deadline_at <= now)
    throw new ApiError(409, "job_deadline_passed", "This job's deadline has passed.");
}

export function assertCanSubmit(job: SubmissionJob, actorId: string) {
  if (job.doer_id !== actorId)
    throw new ApiError(403, "doer_only", "Only the doer who claimed this job can submit work.");
  if (!["in_progress", "revision_requested"].includes(job.status))
    throw new ApiError(409, "job_not_submittable", "This job is not accepting a submission.");
}

export function assertCanRequestRevision(job: ReviewJob, actorId: string) {
  if (job.client_id !== actorId)
    throw new ApiError(403, "client_only", "Only the client can request changes.");
  if (job.status !== "submitted" || !job.active_submission_id)
    throw new ApiError(409, "job_not_reviewable", "Only a submitted job can be sent back for changes.");
}

export function assertCanDispute(job: DisputableJob, actorId: string) {
  if (![job.client_id, job.doer_id].includes(actorId))
    throw new ApiError(403, "job_forbidden", "Only a job participant can open a dispute.");
  if (!["in_progress", "submitted", "revision_requested"].includes(job.status))
    throw new ApiError(409, "job_not_disputable", "This job cannot be disputed in its current state.");
}

export function assertSettlementAllowed(
  job: SettlementJob,
  actorId: string | null,
  cause: string,
  outcome: "pay_doer" | "refund_client",
) {
  if (cause === "client_acceptance") {
    if (job.client_id !== actorId)
      throw new ApiError(403, "client_only", "Only the client can accept work.");
    if (job.status !== "submitted")
      throw new ApiError(409, "job_not_accepting", "Only a submitted job can be accepted.");
  } else if (cause === "default_approval") {
    if (job.status !== "submitted")
      throw new ApiError(409, "job_not_accepting", "Only a submitted job can be approved by default.");
  } else if (cause === "client_cancel") {
    if (job.client_id !== actorId)
      throw new ApiError(403, "client_only", "Only the client can cancel this job.");
    if (job.status !== "ready" && !isOverdueWithoutSubmission(job))
      throw new ApiError(409, "job_not_cancellable", "Only an unclaimed job, or a claimed job 72 hours past its deadline with no submission, can be cancelled for a refund.");
  } else if (cause === "expiry") {
    if (job.status !== "ready")
      throw new ApiError(409, "job_not_expirable", "Only an unclaimed job can expire.");
  } else if (job.status !== "disputed") {
    throw new ApiError(409, "job_not_disputed", "Only a disputed job can be resolved.");
  }
  if (outcome === "pay_doer" && (!job.doer_id || !job.doer_wallet))
    throw new ApiError(409, "doer_missing", "This job has no assigned doer to pay.");
}
