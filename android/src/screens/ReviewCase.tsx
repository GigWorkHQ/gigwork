import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { REVIEW_STATUS } from "../../../src/live.js";
import { errorMessage, reviews } from "../api";
import { useApp, useLoad } from "../app";
import { dateTime } from "../format";
import { color, font } from "../theme";
import { Body, Button, Card, ErrorBox, Field, Heading, Loading, Mono, Muted, Notice, StatusPill } from "../ui";
import { DetailScreen } from "./Detail";

const label: Record<string, string> = { job: "Job dispute", assignment: "Quick-task rejection", milestone: "Milestone dispute" };

/** A case drawn to this account as an independent reviewer. */
export function ReviewCase({ id }: { id: string }) {
  const { session, notify, back } = useApp();
  const load = useLoad(() => reviews.get(session.token, id), [id]);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [share, setShare] = useState("50");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (load.error && !load.data) return <DetailScreen><ErrorBox message={load.error} onRetry={load.reload} /></DetailScreen>;
  if (!load.data) return <DetailScreen><Loading /></DetailScreen>;
  const d = load.data;
  const s = d.subject;
  const options: [string, string][] = [
    ["pay_worker", `Pay the worker ${s.amount} USDG`],
    ["refund_client", s.kind === "assignment" ? "Uphold the rejection (not paid)" : `Refund the client ${s.amount} USDG`],
    ...(d.allowsSplit ? [["split", "Split between them"] as [string, string]] : []),
  ];
  async function resolve() {
    setBusy(true); setError("");
    try {
      await reviews.resolve(session.token, id, { outcome: outcome!, note: note.trim(), ...(outcome === "split" ? { workerShareBps: Math.round(Number(share) * 100) } : {}) });
      notify("Decided. The escrow settlement has started.");
      back();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  return (
    <DetailScreen title={s.title} status={<StatusPill map={REVIEW_STATUS} value={d.case.status} />}>
      <Mono>{(label[d.case.subjectKind] ?? "Case").toUpperCase()} · {s.amount} USDG{d.case.dueAt ? ` · DECIDE BY ${dateTime(d.case.dueAt).toUpperCase()}` : ""}</Mono>
      <Card>
        <Heading style={{ fontSize: 20 }}>Brief</Heading>
        <Body selectable style={{ fontSize: 14 }}>{s.brief ?? s.prompt}</Body>
        {(s.criteria ?? []).map((c: string) => <Body key={c} style={{ fontSize: 14 }}>• {c}</Body>)}
        {s.options?.length ? <Muted style={{ fontSize: 13 }}>Options: {s.options.join(" · ")}</Muted> : null}
      </Card>
      <Notice tint="coral">{`${d.case.openedByClient ? "Client" : "Worker"}'s reason: ${d.reason}`}</Notice>
      {s.kind === "assignment" ? (
        <Card>
          <Mono>WORKER'S ANSWER</Mono>
          <Body>{s.response?.choice ?? ""}{s.response?.answer ? ` — ${s.response.answer}` : ""}</Body>
          {s.rejectionReason ? <><Mono>CLIENT'S REJECTION</Mono><Body style={{ fontSize: 14 }}>{s.rejectionReason}</Body></> : null}
        </Card>
      ) : null}
      {(s.submissions ?? s.thread ?? []).map((entry: any, i: number) => (
        <Card key={i}>
          <Mono>{entry.type === "feedback" ? "CHANGES REQUESTED" : `DELIVERY${entry.revision ? ` · REVISION ${entry.revision}` : ""}`}</Mono>
          {entry.type === "feedback" ? <Body style={{ fontSize: 14 }}>{entry.text}</Body> : <><Body style={{ fontSize: 14 }}>{entry.summary}</Body><Body selectable style={{ fontSize: 13, backgroundColor: color.paper, padding: 10, borderRadius: 10 }}>{entry.deliverable}</Body></>}
        </Card>
      ))}
      {(s.revisions ?? []).map((r: any) => <Notice key={r.id} tint="yellow">{`Changes requested on revision ${r.revision}: ${r.feedback}`}</Notice>)}

      {d.case.status === "resolved" ? <Notice tint="blue">{`Resolved: ${d.case.resolution}.`}</Notice> : (
        <>
          <Heading style={{ fontSize: 22 }}>Your decision</Heading>
          {options.map(([key, text]) => (
            <Pressable key={key} onPress={() => setOutcome(key)} style={{ padding: 16, borderRadius: 16, borderWidth: outcome === key ? 2 : 1, borderColor: outcome === key ? color.navy : color.line, backgroundColor: outcome === key ? color.green : color.white }}>
              <Text style={{ fontFamily: font.sansMedium, fontSize: 15, color: color.navy }}>{text}</Text>
            </Pressable>
          ))}
          {outcome === "split" ? <Field label="Worker's share (%)" value={share} onChangeText={(v) => setShare(v.replace(/[^\d.]/g, ""))} /> : null}
          <Field label="Decision note" value={note} onChangeText={setNote} multiline placeholder="Explain the decision against the brief." />
          {error ? <Notice tint="coral">{error}</Notice> : null}
          <View><Button title={busy ? "Resolving…" : "Resolve and settle"} busy={busy} disabled={!outcome || !note.trim()} onPress={resolve} /></View>
        </>
      )}
    </DetailScreen>
  );
}
