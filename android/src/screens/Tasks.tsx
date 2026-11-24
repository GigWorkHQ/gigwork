import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BATCH_STATUS, TASK_STATUS, capitalize, hourlyRate } from "../../../src/live.js";
import { batches, tasks } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { dateTime, relative } from "../format";
import { color, font } from "../theme";
import { Amount, Body, Button, Card, Empty, ErrorBox, Field, Heading, Loading, Mono, Muted, Notice, StatusPill, openWeb } from "../ui";
import { DetailScreen, TextSheet, useAct } from "./Detail";

/** A live batch from the feed: read the instructions, then claim the next item. */
export function TaskBatch({ batch }: { batch: any }) {
  const { session, go } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function claim() {
    setBusy(true); setError("");
    try { const assignment = await tasks.claim(session.token, batch.id); go({ kind: "assignment", id: assignment.id }); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't claim a task."); setBusy(false); }
  }
  return (
    <DetailScreen title={batch.title} status={<Mono>{capitalize(batch.taskType).toUpperCase()} · {batch.available} LEFT</Mono>}>
      <Card>
        <Amount value={batch.pay} size={34} />
        <Muted style={{ fontSize: 13 }}>About {batch.minutes} min each · {hourlyRate(batch.pay, batch.minutes).toFixed(2)} USDG per hour · {batch.claimMinutes} min to finish once claimed</Muted>
        <Mono>INSTRUCTIONS</Mono>
        <Body selectable>{batch.instructions}</Body>
      </Card>
      <Notice tint="purple">{`The client has ${batch.reviewHours} hours to review each answer. If they don't, it's approved and paid automatically.`}</Notice>
      {error ? <Notice tint="coral">{error}</Notice> : null}
      <Button title={busy ? "Claiming…" : "Claim a task"} busy={busy} onPress={claim} />
    </DetailScreen>
  );
}

/** A claimed quick task: answer it, release it, or dispute a rejection. */
export function Assignment({ id }: { id: string }) {
  const { session, back } = useApp();
  const t = session.token;
  const load = useLoad(async () => {
    const found = (await tasks.assignments(t)).find((a: any) => a.id === id);
    if (!found) throw new Error("This task is no longer yours. It may have been released or expired.");
    return found;
  }, [id, t]);
  const { act, running } = useAct(load.reload);
  const [choice, setChoice] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [dispute, setDispute] = useState(false);
  if (load.error && !load.data) return <DetailScreen><ErrorBox message={load.error} onRetry={load.reload} /></DetailScreen>;
  if (!load.data) return <DetailScreen><Loading /></DetailScreen>;
  const a = load.data;
  const options: string[] = a.options ?? [];
  const ready = options.length ? Boolean(choice) : answer.trim().length > 0;

  return (
    <DetailScreen title={a.title} status={<StatusPill map={TASK_STATUS} value={a.status} />} refreshing={load.refreshing} onRefresh={load.reload}>
      <Card>
        <Mono>ITEM {a.itemPosition} · {a.pay} USDG</Mono>
        <Heading style={{ fontSize: 22 }}>{a.prompt}</Heading>
        <Muted style={{ fontSize: 14 }}>{a.instructions}</Muted>
      </Card>
      {a.status === "claimed" ? (
        <>
          <Notice tint="yellow">{`Finish ${relative(a.leaseUntil)}. After that the task goes back to the pool.`}</Notice>
          {options.map((option) => (
            <Pressable key={option} onPress={() => setChoice(option)} style={{ padding: 16, borderRadius: 16, borderWidth: choice === option ? 2 : 1, borderColor: choice === option ? color.navy : color.line, backgroundColor: choice === option ? color.green : color.white }}>
              <Text style={{ fontFamily: font.sansMedium, fontSize: 16, color: color.navy }}>{option}</Text>
            </Pressable>
          ))}
          <Field label={options.length ? "Note (optional)" : "Your answer"} value={answer} onChangeText={setAnswer} multiline placeholder={options.length ? "Anything the client should know" : "Write your answer"} />
          <Button title="Submit answer" disabled={!ready} busy={running === "submit"} onPress={() => act("submit", () => tasks.submit(t, id, { answer: answer.trim(), ...(choice ? { choice } : {}) }), "Submitted. You're paid when it's approved.")} />
          <Button kind="outline" title="Release this task" busy={running === "release"} onPress={async () => { if (await act("release", () => tasks.release(t, id), "Released back to the pool.")) back(); }} />
        </>
      ) : (
        <Card>
          <Mono>YOUR ANSWER</Mono>
          <Body>{a.response?.choice ?? ""}{a.response?.answer ? ` — ${a.response.answer}` : ""}</Body>
          {a.status === "submitted" && a.reviewDueAt ? <Muted style={{ fontSize: 13 }}>Approved automatically {relative(a.reviewDueAt)} unless the client rejects it.</Muted> : null}
          {a.rejectionReason ? <Notice tint="coral">{`Rejected: ${a.rejectionReason}`}</Notice> : null}
          {a.payout?.status ? <Muted style={{ fontSize: 13 }}>Payout: {a.payout.status === "complete" ? "paid" : a.payout.status}</Muted> : null}
        </Card>
      )}
      {a.status === "rejected" ? <Button kind="outline" title="Dispute this rejection" onPress={() => setDispute(true)} /> : null}
      <TextSheet visible={dispute} title="Dispute the rejection" submit="Open dispute" onClose={() => setDispute(false)}
        intro={a.disputeDueAt ? `You can dispute until ${dateTime(a.disputeDueAt)}. An independent reviewer decides.` : "An independent reviewer decides."}
        fields={[{ key: "reason", label: "Why your answer meets the instructions", multiline: true, min: 10 }]}
        onSubmit={async (v) => { await tasks.dispute(t, id, v.reason); load.reload(); }} />
    </DetailScreen>
  );
}

/** A batch this account posted: approve or reject answers, close it. Funding opens the web. */
export function BatchDetail({ id }: { id: string }) {
  const { session } = useApp();
  const t = session.token;
  const load = useLoad(async () => {
    const batch = await batches.get(t, id);
    const submissions = batch.status === "awaiting_funding" ? [] : await batches.submissions(t, id);
    return { batch, submissions };
  }, [id, t]);
  const { act, running } = useAct(load.reload);
  const [rejecting, setRejecting] = useState<string | null>(null);
  if (load.error && !load.data) return <DetailScreen><ErrorBox message={load.error} onRetry={load.reload} /></DetailScreen>;
  if (!load.data) return <DetailScreen><Loading /></DetailScreen>;
  const { batch: b, submissions } = load.data;
  const waiting = submissions.filter((s: any) => s.status === "submitted");

  return (
    <DetailScreen title={b.title} status={<StatusPill map={BATCH_STATUS} value={b.status} />} refreshing={load.refreshing} onRefresh={load.reload}>
      <Card>
        <Amount value={b.total} size={30} />
        <Muted style={{ fontSize: 13 }}>{b.itemsCount} items × {b.workersPerItem} worker{b.workersPerItem > 1 ? "s" : ""} at {b.pay} USDG · {b.credited}/{b.slots} credited</Muted>
      </Card>
      {b.status === "awaiting_funding" ? (
        <Notice tint="coral">
          <Body style={{ fontSize: 14 }}>Send {b.total} USDG to this batch's escrow to put it live. Funding needs your wallet, so it happens on the web.</Body>
          <Button small title="Fund on the web" onPress={() => openWeb(`${WEB}/app/tasks?as=client&open=${b.id}`)} style={{ marginTop: 8 }} />
        </Notice>
      ) : null}
      {waiting.length > 1 ? <Button title={`Approve all ${waiting.length}`} busy={running === "all"} onPress={() => act("all", () => batches.approveAll(t, id), "All approved. Payouts are on their way.")} /> : null}
      {submissions.length ? submissions.map((s: any) => (
        <Card key={s.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Mono>ITEM {s.itemPosition} · {s.worker}</Mono>
            <StatusPill map={TASK_STATUS} value={s.status} />
          </View>
          <Body style={{ fontSize: 14 }}>{s.prompt}</Body>
          {s.response ? <Body style={{ fontFamily: font.sansMedium }}>{s.response.choice ?? ""}{s.response.answer ? ` — ${s.response.answer}` : ""}</Body> : <Muted style={{ fontSize: 13 }}>Not answered yet</Muted>}
          {s.status === "submitted" ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button small title="Approve" style={{ flex: 1 }} busy={running === s.id} onPress={() => act(s.id, () => batches.approve(t, id, s.id), "Approved. The worker is being paid.")} />
              <Button small kind="outline" title="Reject" style={{ flex: 1 }} onPress={() => setRejecting(s.id)} />
            </View>
          ) : null}
        </Card>
      )) : b.status !== "awaiting_funding" ? <Empty mascot="robot" title="No answers yet" text="Answers appear here as workers submit them." /> : null}
      {["live", "awaiting_funding"].includes(b.status) ? <Button kind="outline" title={b.status === "live" ? "Close batch" : "Cancel batch"} busy={running === "close"} onPress={() => act("close", () => batches.close(t, id), b.status === "live" ? "Closing. Work in progress finishes, then the unused balance is refunded." : "Batch cancelled.")} /> : null}
      <TextSheet visible={!!rejecting} title="Reject this answer" submit="Reject" onClose={() => setRejecting(null)}
        intro="Explain against the instructions. The worker can dispute it, and an independent reviewer decides."
        fields={[{ key: "reason", label: "Reason", multiline: true, min: 10 }]}
        onSubmit={async (v) => { await batches.reject(t, id, rejecting!, v.reason); load.reload(); }} />
    </DetailScreen>
  );
}
