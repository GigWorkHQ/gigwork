// "Needs you": everything across jobs, quick tasks, gigs, contracts and review cases that is waiting on this account,
// most urgent first. Pure, so it is unit-tested without a phone. Funding is listed too, but it opens the web: the
// wallet that funds escrow lives there.
import { availableActions, roleIn } from "../../src/live.js";
import type { Route } from "./app";

export type Need = { key: string; title: string; detail: string; action: string; tint: "green" | "blue" | "yellow" | "coral" | "purple"; route?: Route; web?: string; rank: number };

export function buildNeeds(input: { wallet: string; jobs?: any[]; assignments?: any[]; gigs?: any[]; contracts?: any[]; reviews?: any }): Need[] {
  const needs: Need[] = [];
  for (const job of input.jobs ?? []) {
    const can = availableActions(job, input.wallet);
    const role = roleIn(job, input.wallet);
    const route: Route = { kind: "job", id: job.id };
    if (can.review) needs.push({ key: `job-review-${job.id}`, title: job.title, detail: `Submitted · ${job.amount} USDG waiting for your review`, action: "Review", tint: "blue", route, rank: 1 });
    else if (can.submit) needs.push({ key: `job-submit-${job.id}`, title: job.title, detail: job.status === "revision_requested" ? "Changes requested" : `In progress · ${job.amount} USDG`, action: "Submit", tint: "yellow", route, rank: job.status === "revision_requested" ? 1 : 2 });
    else if (can.fund) needs.push({ key: `job-fund-${job.id}`, title: job.title, detail: `Fund ${job.amount} USDG to list it`, action: "Fund on web", tint: "coral", route, web: `/app/jobs?as=client&open=${job.id}`, rank: 4 });
    else if (role && job.status === "disputed") needs.push({ key: `job-dispute-${job.id}`, title: job.title, detail: "In dispute review", action: "View", tint: "coral", route, rank: 5 });
  }
  for (const a of input.assignments ?? []) {
    if (a.status === "claimed") needs.push({ key: `task-${a.id}`, title: a.title, detail: `Quick task · ${a.pay} USDG`, action: "Answer", tint: "purple", route: { kind: "assignment", id: a.id }, rank: 0 });
    else if (a.status === "rejected") needs.push({ key: `task-rejected-${a.id}`, title: a.title, detail: "Rejected · you can dispute it", action: "View", tint: "coral", route: { kind: "assignment", id: a.id }, rank: 3 });
  }
  for (const gig of input.gigs ?? []) {
    const route: Route = { kind: "gig", id: gig.id };
    if (gig.role === "invited" && gig.status === "open") { needs.push({ key: `gig-invite-${gig.id}`, title: gig.title, detail: `You're invited · ${gig.total} USDG`, action: "Respond", tint: "green", route, rank: 1 }); continue; }
    for (const m of gig.milestones ?? []) {
      const label = `${gig.title} · ${m.title}`;
      if (gig.role === "worker" && gig.status === "active") {
        if (m.status === "funded") needs.push({ key: `ms-start-${m.id}`, title: label, detail: `Funded · ${m.amount} USDG`, action: "Start", tint: "green", route, rank: 2 });
        if (["in_progress", "revision_requested"].includes(m.status)) needs.push({ key: `ms-submit-${m.id}`, title: label, detail: m.status === "revision_requested" ? "Changes requested" : "In progress", action: "Submit", tint: "yellow", route, rank: 1 });
      }
      if (gig.role === "client") {
        if (m.status === "submitted") needs.push({ key: `ms-review-${m.id}`, title: label, detail: `Delivered · ${m.amount} USDG waiting for your review`, action: "Review", tint: "blue", route, rank: 1 });
        if (m.status === "unfunded" && gig.status !== "cancelled") needs.push({ key: `ms-fund-${m.id}`, title: label, detail: `Fund ${m.amount} USDG`, action: "Fund on web", tint: "coral", route, web: `/app/live-gigs?as=client&open=${gig.id}`, rank: 4 });
      }
    }
  }
  for (const c of input.contracts ?? []) {
    const route: Route = { kind: "contract", id: c.id };
    if (c.role === "worker" && c.status === "offered") needs.push({ key: `contract-offer-${c.id}`, title: c.title, detail: `Offer · ${c.rate} USDG every ${c.periodDays} days`, action: "Respond", tint: "green", route, rank: 1 });
    if (c.role === "worker" && c.status === "active" && c.proposedRate) needs.push({ key: `contract-rate-${c.id}`, title: c.title, detail: `New rate proposed: ${c.proposedRate} USDG`, action: "Respond", tint: "yellow", route, rank: 1 });
    if (c.role === "client" && c.status === "active" && c.nextPeriod && !(c.periods ?? []).some((p: any) => p.status === "reserved" && new Date(p.endsAt) > new Date()))
      needs.push({ key: `contract-reserve-${c.id}`, title: c.title, detail: `Reserve the next ${c.rate} USDG period`, action: "Fund on web", tint: "coral", route, web: `/app/payruns?as=client&open=${c.id}`, rank: 4 });
  }
  for (const r of input.reviews?.assigned ?? [])
    needs.push({ key: `review-${r.id}`, title: "Review case", detail: r.dueAt ? `Decide by ${new Date(r.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Assigned to you", action: "Decide", tint: "purple", route: { kind: "review", id: r.id }, rank: 0 });
  return needs.sort((a, b) => a.rank - b.rank);
}
