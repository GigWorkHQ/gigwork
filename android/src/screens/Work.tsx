import React, { useState } from "react";
import { Briefcase, ListChecks, Milestone, Repeat } from "lucide-react-native";
import { CONTRACT_STATUS, GIG_STATUS, JOB_STATUS, TASK_STATUS, capitalize, hourlyRate } from "../../../src/live.js";
import { contracts, gigs, jobs, tasks } from "../api";
import { useApp, useLoad } from "../app";
import { party, relative, who } from "../format";
import { color } from "../theme";
import { Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Segmented, StatusPill, Title, Pill } from "../ui";

type Segment = "jobs" | "tasks" | "gigs" | "mine";

/** Funded work anyone can take, plus the work this account is doing. */
export function Work() {
  const [segment, setSegment] = useState<Segment>("jobs");
  return (
    <Screen>
      <Title>Find work</Title>
      <Muted>Everything listed here is already funded in USDG escrow.</Muted>
      <Segmented value={segment} onChange={setSegment} options={[["jobs", "Jobs"], ["tasks", "Quick tasks"], ["gigs", "Gigs"], ["mine", "My work"]]} />
      {segment === "jobs" ? <OpenJobs /> : segment === "tasks" ? <OpenTasks /> : segment === "gigs" ? <OpenGigs /> : <MyWork />}
    </Screen>
  );
}

function List({ load, empty, render }: { load: ReturnType<typeof useLoad<any[]>>; empty: React.ReactNode; render: (item: any) => React.ReactNode }) {
  if (load.error && !load.data) return <ErrorBox message={load.error} onRetry={load.reload} />;
  if (!load.data) return <Loading />;
  if (!load.data.length) return <>{empty}</>;
  return <Card style={{ paddingVertical: 6, gap: 0 }}>{load.data.map(render)}</Card>;
}

function OpenJobs() {
  const { session, go } = useApp();
  const load = useLoad(async () => (await jobs.ready()).filter((j: any) => j.clientWallet?.toLowerCase() !== session.walletAddress.toLowerCase()), []);
  return (
    <List load={load} empty={<Empty title="No open jobs right now" text="Funded jobs appear here the moment a client funds them." />}
      render={(j) => (
        <Row key={j.id} tint="green" icon={<Briefcase size={18} color={color.navy} />} title={j.title}
          detail={`${who(j.clientHandle, j.clientWallet)}${j.deadlineAt ? ` · due ${relative(j.deadlineAt)}` : ""}`}
          trailing={<Pill label={`${j.amount} USDG`} tint="green" />} onPress={() => go({ kind: "job", id: j.id })} />
      )} />
  );
}

function OpenTasks() {
  const { session, go } = useApp();
  const load = useLoad(async () => (await tasks.list()).filter((b: any) => b.clientWallet?.toLowerCase() !== session.walletAddress.toLowerCase()), []);
  return (
    <List load={load} empty={<Empty mascot="robot" title="No quick tasks right now" text="Batches of short Judge, Verify, Label and Test tasks show up here." />}
      render={(b) => (
        <Row key={b.id} tint="purple" icon={<ListChecks size={18} color={color.navy} />} title={b.title}
          detail={`${capitalize(b.taskType)} · ${b.available} left · ~${b.minutes} min · ${hourlyRate(b.pay, b.minutes).toFixed(2)} USDG/h`}
          trailing={<Pill label={`${b.pay} USDG`} tint="purple" />} onPress={() => go({ kind: "taskBatch", batch: b })} />
      )} />
  );
}

function OpenGigs() {
  const { session, go } = useApp();
  const load = useLoad(async () => (await gigs.open()).filter((g: any) => g.client?.wallet?.toLowerCase() !== session.walletAddress.toLowerCase()), []);
  return (
    <List load={load} empty={<Empty mascot="fox" title="No open gigs right now" text="Milestone gigs are funded one milestone at a time, before work on it starts." />}
      render={(g) => (
        <Row key={g.id} tint="blue" icon={<Milestone size={18} color={color.navy} />} title={g.title}
          detail={`${g.category} · ${g.milestones?.length ?? 0} milestones · ${party(g.client)}`}
          trailing={<Pill label={`${g.total} USDG`} tint="blue" />} onPress={() => go({ kind: "gig", id: g.id })} />
      )} />
  );
}

function MyWork() {
  const { session, go } = useApp();
  const t = session.token;
  const me = session.walletAddress.toLowerCase();
  const load = useLoad(async () => {
    const [mine, assignments, myGigs, myContracts] = await Promise.all([jobs.mine(t), tasks.assignments(t), gigs.mine(t), contracts.mine(t)]);
    return [
      ...mine.filter((j: any) => j.doerWallet?.toLowerCase() === me).map((j: any) => ({ key: `j${j.id}`, kind: "job", item: j })),
      ...assignments.map((a: any) => ({ key: `a${a.id}`, kind: "assignment", item: a })),
      ...myGigs.filter((g: any) => g.role === "worker" || g.role === "invited").map((g: any) => ({ key: `g${g.id}`, kind: "gig", item: g })),
      ...myContracts.filter((c: any) => c.role === "worker").map((c: any) => ({ key: `c${c.id}`, kind: "contract", item: c })),
    ];
  }, [t]);
  return (
    <List load={load} empty={<Empty title="Nothing claimed yet" text="Work you claim, accept or are invited to shows up here." />}
      render={({ key, kind, item }) => {
        if (kind === "job") return <Row key={key} tint="green" icon={<Briefcase size={18} color={color.navy} />} title={item.title} detail={`Job · ${item.amount} USDG`} trailing={<StatusPill map={JOB_STATUS} value={item.status} />} onPress={() => go({ kind: "job", id: item.id })} />;
        if (kind === "assignment") return <Row key={key} tint="purple" icon={<ListChecks size={18} color={color.navy} />} title={item.title} detail={`Quick task #${item.itemPosition} · ${item.pay} USDG${item.status === "claimed" ? ` · ${relative(item.leaseUntil)}` : ""}`} trailing={<StatusPill map={TASK_STATUS} value={item.status} />} onPress={() => go({ kind: "assignment", id: item.id })} />;
        if (kind === "gig") return <Row key={key} tint="blue" icon={<Milestone size={18} color={color.navy} />} title={item.title} detail={`Gig · ${item.total} USDG${item.role === "invited" ? " · invitation" : ""}`} trailing={<StatusPill map={GIG_STATUS} value={item.status} />} onPress={() => go({ kind: "gig", id: item.id })} />;
        return <Row key={key} tint="yellow" icon={<Repeat size={18} color={color.navy} />} title={item.title} detail={`Contract · ${item.rate} USDG / ${item.periodDays} days`} trailing={<StatusPill map={CONTRACT_STATUS} value={item.status} />} onPress={() => go({ kind: "contract", id: item.id })} />;
      }} />
  );
}

