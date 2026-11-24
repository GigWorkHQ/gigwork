import React, { useState } from "react";
import { View } from "react-native";
import { GIG_STATUS, MILESTONE_STATUS, lines, validateSubmission } from "../../../src/live.js";
import { gigs } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { dateTime, party, relative } from "../format";
import { color } from "../theme";
import { Amount, Body, Button, Card, ErrorBox, Heading, Loading, Mono, Muted, Notice, StatusPill, openWeb } from "../ui";
import { DetailScreen, TextSheet, useAct } from "./Detail";

type Sheet = { kind: "submit" | "revision" | "dispute"; milestoneId: string } | null;

export function GigDetail({ id }: { id: string }) {
  const { session } = useApp();
  const t = session.token;
  const load = useLoad(() => gigs.get(t, id), [id, t]);
  const { act, running } = useAct(load.reload);
  const [sheet, setSheet] = useState<Sheet>(null);
  if (load.error && !load.data) return <DetailScreen><ErrorBox message={load.error} onRetry={load.reload} /></DetailScreen>;
  if (!load.data) return <DetailScreen><Loading /></DetailScreen>;
  const g = load.data;
  const worker = g.role === "worker";
  const client = g.role === "client";
  const canAccept = g.status === "open" && !client && (g.role === "invited" || !g.invited);
  const milestoneAct = (milestoneId: string, action: string, message: string, body?: unknown) =>
    act(`${milestoneId}:${action}`, () => gigs.milestone(t, id, milestoneId, action, body), message);

  return (
    <DetailScreen title={g.title} status={<StatusPill map={GIG_STATUS} value={g.status} />} refreshing={load.refreshing} onRefresh={load.reload}>
      <Card>
        <Amount value={g.total} size={34} />
        <Muted style={{ fontSize: 13 }}>{g.category} · client {party(g.client)}{g.worker ? ` · worker ${party(g.worker)}` : ""} · {g.reviewHours}h review window</Muted>
        <Body selectable>{g.description}</Body>
      </Card>
      {canAccept ? <Button title={running === "accept" ? "Accepting…" : g.role === "invited" ? "Accept the invitation" : "Take this gig"} busy={running === "accept"} onPress={() => act("accept", () => gigs.accept(t, id), "You're on this gig. Start a milestone once it's funded.")} /> : null}

      <Heading style={{ fontSize: 22 }}>Milestones</Heading>
      {g.milestones.map((m: any) => {
        const key = (action: string) => running === `${m.id}:${action}`;
        return (
          <Card key={m.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Body style={{ flex: 1 }}>{m.position}. {m.title}</Body>
              <StatusPill map={MILESTONE_STATUS} value={m.status} />
            </View>
            <Mono>{m.amount} USDG{m.dueAt ? ` · due ${relative(m.dueAt)}` : m.dueDays ? ` · ${m.dueDays} days once started` : ""}</Mono>
            {m.status === "submitted" && m.reviewDueAt ? <Muted style={{ fontSize: 13 }}>{client ? `Review by ${dateTime(m.reviewDueAt)}, or it's approved automatically.` : `Approved automatically ${relative(m.reviewDueAt)} unless the client acts.`}</Muted> : null}
            {(m.thread ?? []).slice(-2).map((entry: any, i: number) => (
              <View key={i} style={{ backgroundColor: entry.type === "feedback" ? color.yellow : color.paper, padding: 10, borderRadius: 10, gap: 4 }}>
                <Mono>{entry.type === "submission" ? "DELIVERY" : "CHANGES REQUESTED"} · {dateTime(entry.at)}</Mono>
                {entry.type === "submission" ? <><Body style={{ fontSize: 14 }}>{entry.summary}</Body><Body selectable style={{ fontSize: 13 }}>{entry.deliverable}</Body></> : <Body style={{ fontSize: 14 }}>{entry.text}</Body>}
              </View>
            ))}
            {m.review ? <Notice tint="purple">With an independent reviewer for a decision.</Notice> : null}
            <View style={{ gap: 8 }}>
              {worker && g.status === "active" && m.status === "funded" ? <Button small title="Start this milestone" busy={key("start")} onPress={() => milestoneAct(m.id, "start", "Started. Submit when it's done.")} /> : null}
              {worker && ["in_progress", "revision_requested"].includes(m.status) ? <Button small title="Submit delivery" onPress={() => setSheet({ kind: "submit", milestoneId: m.id })} /> : null}
              {client && m.status === "submitted" ? <>
                <Button small title={`Approve and release ${m.amount} USDG`} busy={key("approve")} onPress={() => milestoneAct(m.id, "approve", "Approved. The payment is on its way.")} />
                <Button small kind="outline" title="Request changes" onPress={() => setSheet({ kind: "revision", milestoneId: m.id })} />
              </> : null}
              {client && m.status === "unfunded" && g.status !== "cancelled" ? <Button small title="Fund on the web" onPress={() => openWeb(`${WEB}/app/live-gigs?as=client&open=${g.id}`)} /> : null}
              {(client || worker) && ["in_progress", "submitted", "revision_requested"].includes(m.status) ? <Button small kind="outline" title="Open a dispute" onPress={() => setSheet({ kind: "dispute", milestoneId: m.id })} /> : null}
            </View>
          </Card>
        );
      })}
      {client && ["draft", "open", "active"].includes(g.status) && g.milestones.every((m: any) => ["unfunded", "funded", "approved", "refunded", "split", "cancelled"].includes(m.status)) ? (
        <Button kind="outline" title="Cancel gig" busy={running === "cancel"} onPress={() => act("cancel", () => gigs.cancel(t, id), "Gig cancelled. Funded milestones are being refunded.")} />
      ) : null}

      <TextSheet visible={sheet?.kind === "submit"} title="Submit delivery" submit="Submit" onClose={() => setSheet(null)}
        fields={[{ key: "summary", label: "Summary" }, { key: "deliverable", label: "Deliverable", multiline: true, placeholder: "The work, or a link to it" }, { key: "evidence", label: "Evidence links (optional)", multiline: true, min: 0, placeholder: "One https:// link per line" }]}
        onSubmit={async (v) => {
          const first = Object.values(validateSubmission(v))[0];
          if (first) throw new Error(String(first));
          await gigs.milestone(t, id, sheet!.milestoneId, "submit", { summary: v.summary, deliverable: v.deliverable, evidence: lines(v.evidence) });
          load.reload();
        }} />
      <TextSheet visible={sheet?.kind === "revision"} title="Request changes" submit="Send to the worker" onClose={() => setSheet(null)}
        fields={[{ key: "feedback", label: "What needs to change", multiline: true }]}
        onSubmit={async (v) => { await gigs.milestone(t, id, sheet!.milestoneId, "revision", { feedback: v.feedback }); load.reload(); }} />
      <TextSheet visible={sheet?.kind === "dispute"} title="Open a dispute" submit="Open dispute" onClose={() => setSheet(null)}
        intro="An independent reviewer decides, and can split the milestone between you."
        fields={[{ key: "reason", label: "Why", multiline: true, min: 10 }]}
        onSubmit={async (v) => { await gigs.milestone(t, id, sheet!.milestoneId, "dispute", { reason: v.reason }); load.reload(); }} />
    </DetailScreen>
  );
}
