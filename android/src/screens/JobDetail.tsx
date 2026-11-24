import React, { useState } from "react";
import { View } from "react-native";
import { JOB_STATUS, availableActions, lines, roleIn, validateSubmission } from "../../../src/live.js";
import { chainConfig, jobs } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { dateTime, relative, who } from "../format";
import { color } from "../theme";
import { Amount, Body, Button, Card, ErrorBox, Heading, Loading, Mono, Muted, Notice, StatusPill, TxLink, openWeb } from "../ui";
import { DetailScreen, TextSheet, useAct } from "./Detail";

export function JobDetail({ id }: { id: string }) {
  const { session } = useApp();
  const t = session.token;
  const load = useLoad(async () => {
    const job = await jobs.get(t, id);
    const role = roleIn(job, session.walletAddress);
    const thread = role && !["awaiting_funding", "ready"].includes(job.status)
      ? await Promise.all([jobs.submissions(t, id).catch(() => []), jobs.revisions(t, id).catch(() => [])]) : [[], []];
    const config = await chainConfig().catch(() => null);
    return { job, submissions: thread[0], revisions: thread[1], explorer: config?.explorerUrl };
  }, [id, t]);
  const { act, running } = useAct(load.reload);
  const [sheet, setSheet] = useState<"submit" | "revise" | "dispute" | null>(null);
  if (load.error && !load.data) return <DetailScreen><ErrorBox message={load.error} onRetry={load.reload} /></DetailScreen>;
  if (!load.data) return <DetailScreen><Loading /></DetailScreen>;
  const { job, submissions, revisions, explorer } = load.data;
  const role = roleIn(job, session.walletAddress);
  const can = availableActions(job, session.walletAddress);
  const cancellable = role === "client" && ["awaiting_funding", "ready"].includes(job.status);

  return (
    <DetailScreen title={job.title} status={<StatusPill map={JOB_STATUS} value={job.status} />} refreshing={load.refreshing} onRefresh={load.reload}>
      <Card>
        <Amount value={job.amount} size={34} />
        <Muted style={{ fontSize: 13 }}>
          Client {who(job.clientHandle, job.clientWallet)}{job.doerWallet ? ` · worker ${who(job.doerHandle, job.doerWallet)}` : ""}{job.deadlineAt ? ` · due ${relative(job.deadlineAt)}` : ""}
        </Muted>
        <Body selectable>{job.description}</Body>
        <Mono>ACCEPTANCE CRITERIA</Mono>
        {job.acceptanceCriteria.map((c: string) => <Body key={c} style={{ fontSize: 14 }}>• {c}</Body>)}
      </Card>

      {job.payout?.failed ? <Notice tint="coral">The payout was rejected on-chain. The funds are safe in escrow, and the GigWork team will retry it once the cause is fixed.</Notice>
        : job.status === "settlement_pending" ? <Notice tint="blue">The payout is being sent and confirmed. This usually takes a few minutes.</Notice> : null}
      {job.status === "submitted" && job.reviewDueAt ? <Notice tint="yellow">{role === "client" ? `Review by ${dateTime(job.reviewDueAt)}. If you don't, the work is approved and paid automatically.` : `The client has until ${dateTime(job.reviewDueAt)} to review. After that it's approved automatically.`}</Notice> : null}
      {job.review ? <Notice tint="purple">This job is with {job.review.status === "escalated" ? "the GigWork team" : "an independent reviewer"} for a decision.</Notice> : null}

      {can.claim ? <Button title={running === "claim" ? "Claiming…" : `Claim this job · ${job.amount} USDG`} busy={running === "claim"} onPress={() => act("claim", () => jobs.claim(t, id), "Claimed. It's yours: submit when you're done.")} /> : null}
      {can.submit ? <Button title={job.status === "revision_requested" ? "Submit the revised work" : "Submit work"} onPress={() => setSheet("submit")} /> : null}
      {can.review ? (
        <View style={{ gap: 10 }}>
          <Button title={running === "accept" ? "Releasing…" : `Approve and release ${job.amount} USDG`} busy={running === "accept"} onPress={() => act("accept", () => jobs.accept(t, id), "Approved. The payment is on its way to the worker.")} />
          <Button kind="outline" title="Request changes" onPress={() => setSheet("revise")} />
        </View>
      ) : null}
      {can.fund ? (
        <Notice tint="coral">
          <Body style={{ fontSize: 14 }}>Fund {job.amount} USDG into this job's escrow to list it. Funding needs your wallet, so it happens on the web.</Body>
          <Button small title="Fund on the web" onPress={() => openWeb(`${WEB}/app/jobs?as=client&open=${job.id}`)} style={{ marginTop: 8 }} />
        </Notice>
      ) : null}
      {can.dispute ? <Button kind="outline" title="Open a dispute" onPress={() => setSheet("dispute")} /> : null}
      {cancellable ? <Button kind="outline" title={job.status === "ready" ? "Cancel and refund" : "Cancel job"} busy={running === "cancel"} onPress={() => act("cancel", () => jobs.cancel(t, id), job.status === "ready" ? "Cancelled. The escrow is being refunded to your wallet." : "Job cancelled.")} /> : null}

      {submissions.length || revisions.length ? (
        <Card>
          <Heading style={{ fontSize: 20 }}>Submissions</Heading>
          {submissions.map((sub: any) => (
            <View key={sub.id} style={{ gap: 6, borderTopWidth: 1, borderTopColor: color.line, paddingTop: 10 }}>
              <Mono>REVISION {sub.revision} · {dateTime(sub.createdAt ?? sub.created_at)}</Mono>
              <Body style={{ fontFamily: undefined }}>{sub.summary}</Body>
              <Body selectable style={{ fontSize: 14, backgroundColor: color.paper, padding: 10, borderRadius: 10 }}>{sub.deliverable}</Body>
              {(sub.evidence ?? []).map((url: string) => <Body key={url} style={{ fontSize: 13, color: color.flame }} selectable>{url}</Body>)}
              {revisions.filter((r: any) => r.revision === sub.revision).map((r: any) => <Notice key={r.id} tint="yellow">{`Changes requested: ${r.feedback}`}</Notice>)}
            </View>
          ))}
        </Card>
      ) : null}
      {job.fundingTransaction ? <TxLink hash={job.fundingTransaction} explorer={explorer} label="Funding transaction" /> : null}
      <Mono selectable>ESCROW {job.escrowAddress}</Mono>

      <TextSheet visible={sheet === "submit"} title="Submit work" submit="Submit" onClose={() => setSheet(null)}
        intro="Describe what you delivered and include the work itself or a link to it. The client reviews it against the criteria."
        fields={[{ key: "summary", label: "Summary", placeholder: "What you delivered" }, { key: "deliverable", label: "Deliverable", placeholder: "The work, or a link to it", multiline: true }, { key: "evidence", label: "Evidence links (optional)", placeholder: "One https:// link per line", multiline: true, min: 0 }]}
        onSubmit={async (v) => {
          const errors = validateSubmission(v);
          const first = Object.values(errors)[0];
          if (first) throw new Error(String(first));
          await jobs.submit(t, id, { summary: v.summary, deliverable: v.deliverable, evidence: lines(v.evidence) });
          load.reload();
        }} />
      <TextSheet visible={sheet === "revise"} title="Request changes" submit="Send to the worker" onClose={() => setSheet(null)}
        intro="Say what's missing against the acceptance criteria. The worker revises and submits again."
        fields={[{ key: "feedback", label: "What needs to change", multiline: true }]}
        onSubmit={async (v) => { await jobs.requestRevision(t, id, v.feedback); load.reload(); }} />
      <TextSheet visible={sheet === "dispute"} title="Open a dispute" submit="Open dispute" onClose={() => setSheet(null)}
        intro="An independent reviewer is drawn at random to decide, with the GigWork team as backstop. The escrow stays locked until then."
        fields={[{ key: "reason", label: "Why", multiline: true }]}
        onSubmit={async (v) => { await jobs.dispute(t, id, v.reason); load.reload(); }} />
    </DetailScreen>
  );
}
