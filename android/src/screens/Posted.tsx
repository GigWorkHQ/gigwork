import React, { useState } from "react";
import { Briefcase, ExternalLink, ListChecks, Milestone, Repeat } from "lucide-react-native";
import { BATCH_STATUS, CONTRACT_STATUS, GIG_STATUS, JOB_STATUS } from "../../../src/live.js";
import { batches, contracts, gigs, jobs } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { party, who } from "../format";
import { color } from "../theme";
import { Button, Card, Empty, ErrorBox, Loading, Muted, Notice, Row, Screen, Segmented, StatusPill, Title, openWeb } from "../ui";

type Segment = "jobs" | "batches" | "gigs" | "contracts";
const WEB_VIEW: Record<Segment, string> = { jobs: "jobs", batches: "tasks", gigs: "live-gigs", contracts: "payruns" };

/** What this account has posted as a client. Posting and funding happen on the web, with the wallet; the rest is here. */
export function Posted() {
  const { session, go } = useApp();
  const t = session.token;
  const me = session.walletAddress.toLowerCase();
  const [segment, setSegment] = useState<Segment>("jobs");
  const load = useLoad(async () => {
    if (segment === "jobs") return (await jobs.mine(t)).filter((j: any) => j.clientWallet?.toLowerCase() === me);
    if (segment === "batches") return batches.mine(t);
    if (segment === "gigs") return (await gigs.mine(t)).filter((g: any) => g.role === "client");
    return (await contracts.mine(t)).filter((c: any) => c.role === "client");
  }, [segment, t]);
  const list: any[] | null = load.data;

  return (
    <Screen refreshing={load.refreshing} onRefresh={load.reload}>
      <Title>Posted</Title>
      <Muted>Review submissions, approve and release, request changes or open a dispute. Write new posts and fund them on the web.</Muted>
      <Segmented value={segment} onChange={setSegment} options={[["jobs", "Jobs"], ["batches", "Task batches"], ["gigs", "Gigs"], ["contracts", "Contracts"]]} />
      {load.error && !list ? <ErrorBox message={load.error} onRetry={load.reload} /> : !list ? <Loading /> : list.length ? (
        <Card style={{ paddingVertical: 6, gap: 0 }}>
          {list.map((item) => {
            if (segment === "jobs") return <Row key={item.id} tint="green" icon={<Briefcase size={18} color={color.navy} />} title={item.title} detail={`${item.amount} USDG${item.doerWallet ? ` · ${who(item.doerHandle, item.doerWallet)}` : ""}`} trailing={<StatusPill map={JOB_STATUS} value={item.status} />} onPress={() => go({ kind: "job", id: item.id })} />;
            if (segment === "batches") return <Row key={item.id} tint="purple" icon={<ListChecks size={18} color={color.navy} />} title={item.title} detail={`${item.credited}/${item.slots} done · ${item.awaitingReview} to review · ${item.total} USDG`} trailing={<StatusPill map={BATCH_STATUS} value={item.status} />} onPress={() => go({ kind: "batch", id: item.id })} />;
            if (segment === "gigs") return <Row key={item.id} tint="blue" icon={<Milestone size={18} color={color.navy} />} title={item.title} detail={`${item.total} USDG · ${item.worker ? party(item.worker) : "no worker yet"}`} trailing={<StatusPill map={GIG_STATUS} value={item.status} />} onPress={() => go({ kind: "gig", id: item.id })} />;
            return <Row key={item.id} tint="yellow" icon={<Repeat size={18} color={color.navy} />} title={item.title} detail={`${item.rate} USDG / ${item.periodDays} days · ${party(item.worker)}`} trailing={<StatusPill map={CONTRACT_STATUS} value={item.status} />} onPress={() => go({ kind: "contract", id: item.id })} />;
          })}
        </Card>
      ) : (
        <Empty mascot="fox" title="Nothing posted here yet" text="Write the post on the web and fund it from your wallet. It shows up here right away." />
      )}
      <Notice tint="green" icon={<ExternalLink size={18} color={color.navy} />}>Posting new work and funding escrow need your wallet, so they happen on the web.</Notice>
      <Button kind="outline" title="Post on the web" onPress={() => openWeb(`${WEB}/app/${WEB_VIEW[segment]}?as=client`)} />
    </Screen>
  );
}
