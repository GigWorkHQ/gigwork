import { describe, expect, test } from "bun:test";
import {
  assertCanDispute,
  assertCanRequestRevision,
  assertCanSubmit,
  assertClaimable,
  assertSettlementAllowed,
} from "../src/lifecycle.js";

function expectApiError(action: () => unknown, status: number, code: string) {
  try {
    action();
    throw new Error("Expected the action to fail.");
  } catch (error) {
    expect(error).toMatchObject({ status, code });
  }
}

describe("job lifecycle authorization and state rules", () => {
  test("claim requires a ready job, a non-client worker, and an open deadline", () => {
    const ready = { client_id: "client", status: "ready", deadline_at: new Date("2030-01-01") };
    expect(() => assertClaimable(ready, "worker", new Date("2029-01-01"))).not.toThrow();
    expectApiError(() => assertClaimable(ready, "client"), 403, "client_cannot_claim");
    expectApiError(() => assertClaimable({ ...ready, status: "in_progress" }, "worker"), 409, "job_not_claimable");
    expectApiError(() => assertClaimable({ ...ready, deadline_at: new Date("2020-01-01") }, "worker"), 409, "job_deadline_passed");
  });

  test("submissions require the assigned doer and a writable job state", () => {
    for (const status of ["in_progress", "revision_requested"])
      expect(() => assertCanSubmit({ doer_id: "worker", status }, "worker")).not.toThrow();
    expectApiError(() => assertCanSubmit({ doer_id: "other", status: "in_progress" }, "worker"), 403, "doer_only");
    expectApiError(() => assertCanSubmit({ doer_id: "worker", status: "completed" }, "worker"), 409, "job_not_submittable");
  });

  test("revision requests require the client and an active submitted delivery", () => {
    const submitted = { client_id: "client", status: "submitted", active_submission_id: "submission" };
    expect(() => assertCanRequestRevision(submitted, "client")).not.toThrow();
    expectApiError(() => assertCanRequestRevision(submitted, "worker"), 403, "client_only");
    expectApiError(() => assertCanRequestRevision({ ...submitted, active_submission_id: null }, "client"), 409, "job_not_reviewable");
  });

  test("only participants can dispute active work", () => {
    const job = { client_id: "client", doer_id: "worker", status: "submitted" };
    expect(() => assertCanDispute(job, "client")).not.toThrow();
    expect(() => assertCanDispute(job, "worker")).not.toThrow();
    expectApiError(() => assertCanDispute(job, "stranger"), 403, "job_forbidden");
    expectApiError(() => assertCanDispute({ ...job, status: "completed" }, "client"), 409, "job_not_disputable");
  });

  test("acceptance and dispute settlement enforce actor, state, and payout recipient", () => {
    const submitted = { client_id: "client", doer_id: "worker", doer_wallet: "0xworker", status: "submitted" };
    expect(() => assertSettlementAllowed(submitted, "client", "client_acceptance", "pay_doer")).not.toThrow();
    expectApiError(() => assertSettlementAllowed(submitted, "worker", "client_acceptance", "pay_doer"), 403, "client_only");
    expectApiError(() => assertSettlementAllowed({ ...submitted, status: "ready" }, "client", "client_acceptance", "pay_doer"), 409, "job_not_accepting");
    const disputed = { ...submitted, status: "disputed" };
    expect(() => assertSettlementAllowed(disputed, "team", "team_dispute_resolution", "refund_client")).not.toThrow();
    expectApiError(() => assertSettlementAllowed(submitted, "team", "team_dispute_resolution", "refund_client"), 409, "job_not_disputed");
    expectApiError(() => assertSettlementAllowed({ ...disputed, doer_id: null, doer_wallet: null }, "team", "team_dispute_resolution", "pay_doer"), 409, "doer_missing");
  });
});
