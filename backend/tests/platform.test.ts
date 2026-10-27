import { describe, expect, test } from "bun:test";
import { batchTotal, belowHourlyFloor } from "../src/batches.js";
import { nextPeriodWindow } from "../src/contracts.js";
import { milestoneCancellable } from "../src/gigs.js";
import { historyCommitment, historySalt, referralEligible } from "../src/account.js";
import { assertSettlementAllowed, isOverdueWithoutSubmission } from "../src/lifecycle.js";

const hours = (n: number) => n * 3_600_000;

describe("quick-task pricing", () => {
  test("enforces the 6 USDG/hour floor exactly", () => {
    expect(belowHourlyFloor(100_000n, 1, 6)).toBe(false); // 0.10 per minute = 6.00/hour
    expect(belowHourlyFloor(99_999n, 1, 6)).toBe(true);
    expect(belowHourlyFloor(480_000n, 2, 6)).toBe(false); // 0.48 for 2 minutes = 14.40/hour
    expect(belowHourlyFloor(300_000n, 5, 6)).toBe(true); // 0.30 for 5 minutes = 3.60/hour
  });
  test("totals pay across items and workers", () => {
    expect(batchTotal(480_000n, 25, 3)).toBe(36_000_000n);
  });
});

describe("contract pay periods", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  test("first or lapsed period starts now", () => {
    expect(nextPeriodWindow(null, 7, now)).toEqual({ startsAt: now, endsAt: new Date("2026-11-03T00:00:00Z") });
    expect(nextPeriodWindow(new Date("2026-10-01T00:00:00Z"), 7, now).startsAt).toEqual(now);
  });
  test("reserved coverage continues back to back", () => {
    const end = new Date("2026-10-30T00:00:00Z");
    expect(nextPeriodWindow(end, 14, now)).toEqual({ startsAt: end, endsAt: new Date("2026-11-13T00:00:00Z") });
  });
});

describe("milestone cancellation", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  test("unstarted milestones can be cancelled", () => {
    expect(milestoneCancellable({ status: "unfunded", due_at: null, submitted_at: null }, now)).toBe(true);
    expect(milestoneCancellable({ status: "funded", due_at: null, submitted_at: null }, now)).toBe(true);
  });
  test("started milestones only on the overdue path with no submission", () => {
    const due = new Date(now.getTime() - hours(73));
    expect(milestoneCancellable({ status: "in_progress", due_at: due, submitted_at: null }, now)).toBe(true);
    expect(milestoneCancellable({ status: "in_progress", due_at: new Date(now.getTime() - hours(71)), submitted_at: null }, now)).toBe(false);
    expect(milestoneCancellable({ status: "in_progress", due_at: due, submitted_at: new Date() }, now)).toBe(false);
    expect(milestoneCancellable({ status: "in_progress", due_at: null, submitted_at: null }, now)).toBe(false);
    for (const status of ["submitted", "revision_requested", "disputed", "approved"])
      expect(milestoneCancellable({ status, due_at: due, submitted_at: null }, now)).toBe(false);
  });
});

describe("job cancellation and default approval", () => {
  const job = { client_id: "c", doer_id: "d", doer_wallet: "0xd", status: "ready", deadline_at: null, active_submission_id: null };
  test("client can cancel an unclaimed job for a refund", () => {
    expect(() => assertSettlementAllowed(job, "c", "client_cancel", "refund_client")).not.toThrow();
    expect(() => assertSettlementAllowed(job, "d", "client_cancel", "refund_client")).toThrow();
  });
  test("claimed jobs are protected until 72h past deadline with nothing submitted", () => {
    const now = new Date();
    const overdue = { ...job, status: "in_progress", deadline_at: new Date(now.getTime() - hours(73)) };
    expect(isOverdueWithoutSubmission(overdue, now)).toBe(true);
    expect(() => assertSettlementAllowed(overdue, "c", "client_cancel", "refund_client")).not.toThrow();
    expect(() => assertSettlementAllowed({ ...overdue, deadline_at: new Date(now.getTime() - hours(1)) }, "c", "client_cancel", "refund_client")).toThrow();
    expect(() => assertSettlementAllowed({ ...overdue, active_submission_id: "s" }, "c", "client_cancel", "refund_client")).toThrow();
  });
  test("default approval and expiry need the right state", () => {
    expect(() => assertSettlementAllowed({ ...job, status: "submitted" }, null, "default_approval", "pay_doer")).not.toThrow();
    expect(() => assertSettlementAllowed({ ...job, status: "disputed" }, null, "default_approval", "pay_doer")).toThrow();
    expect(() => assertSettlementAllowed(job, null, "expiry", "refund_client")).not.toThrow();
    expect(() => assertSettlementAllowed({ ...job, status: "in_progress" }, null, "expiry", "refund_client")).toThrow();
  });
});

describe("referrals and history", () => {
  test("referral bonus needs approved work and time", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    const eightDays = new Date(now.getTime() - 8 * 86_400_000);
    expect(referralEligible(10, eightDays, now)).toBe(true);
    expect(referralEligible(9, eightDays, now)).toBe(false);
    expect(referralEligible(10, new Date(now.getTime() - 86_400_000), now)).toBe(false);
  });
  test("history commitments are salted and order-independent for transactions", () => {
    const entry = { kind: "milestone", ref: "r", title: "Logo", client: "@acme", amountRaw: "1000000", date: "2026-10-27", transactions: ["0xb", "0xa"] };
    const salt = historySalt("user-1", entry.kind, entry.ref);
    expect(salt).not.toBe(historySalt("user-2", entry.kind, entry.ref));
    expect(historyCommitment(entry, salt)).toBe(historyCommitment({ ...entry, transactions: ["0xa", "0xb"] }, salt));
    expect(historyCommitment(entry, salt)).not.toBe(historyCommitment({ ...entry, amountRaw: "2000000" }, salt));
  });
});
