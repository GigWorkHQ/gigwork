import React, { useState } from "react";
import { View } from "react-native";
import { ArrowDownLeft, ArrowUpRight, Heart, History } from "lucide-react-native";
import { PAYOUT_STATUS } from "../../../src/live.js";
import { account, chainConfig } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { day, money } from "../format";
import { color } from "../theme";
import { Button, Card, Empty, ErrorBox, Loading, Muted, Row, Screen, Segmented, StatusPill, Tile, Title, TxLink, Amount, Body, openWeb } from "../ui";

type Segment = "received" | "sent" | "history";

export function Pay() {
  const { session } = useApp();
  const t = session.token;
  const [segment, setSegment] = useState<Segment>("received");
  const load = useLoad(async () => {
    const config = await chainConfig().catch(() => null);
    if (segment === "received") return { config, data: await account.payouts(t) };
    if (segment === "sent") return { config, data: await account.sent(t) };
    return { config, data: await account.history(t) };
  }, [segment, t]);
  const d = load.data?.data;
  const explorer = load.data?.config?.explorerUrl;

  return (
    <Screen refreshing={load.refreshing} onRefresh={load.reload}>
      <Title>Pay</Title>
      <Segmented value={segment} onChange={setSegment} options={[["received", "Received"], ["sent", "Sent"], ["history", "Work history"]]} />
      {load.error && !d ? <ErrorBox message={load.error} onRetry={load.reload} /> : !d ? <Loading /> : segment === "received" ? (
        <>
          <Tile tint="navy" style={{ gap: 6 }}>
            <Muted style={{ color: "#c9ccee" }}>Received</Muted>
            <Amount value={money(d.totals.received)} light />
            <Muted style={{ color: "#c9ccee", fontSize: 13 }}>{money(d.totals.pending)} on its way · {money(d.totals.tips)} in tips</Muted>
          </Tile>
          {d.entries.length || d.tips.length ? (
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {d.tips.map((tip: any) => (
                <Row key={tip.transactionHash} tint="pink" icon={<Heart size={18} color={color.navy} />} title={`Tip · ${tip.amount} USDG`} detail={`${day(tip.createdAt)}${tip.message ? ` · “${tip.message}”` : ""}`} trailing={<TxLink hash={tip.transactionHash} explorer={explorer} label="Tx" />} />
              ))}
              {d.entries.map((e: any, i: number) => (
                <View key={`${e.refId}${i}`}>
                  <Row tint="green" icon={<ArrowDownLeft size={18} color={color.navy} />} title={`${e.label} · ${e.amount} USDG`} detail={`${day(e.completedAt ?? e.createdAt)}${e.note ? ` · ${e.note}` : ""}`} trailing={<StatusPill map={PAYOUT_STATUS} value={e.status} />} />
                  {e.transactionHash ? <View style={{ paddingLeft: 60, marginTop: -8, marginBottom: 6 }}><TxLink hash={e.transactionHash} explorer={explorer} /></View> : null}
                </View>
              ))}
            </Card>
          ) : <Empty title="No pay yet" text="When work you did is approved, the payout shows up here with its transaction." />}
        </>
      ) : segment === "sent" ? (
        <>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Tile tint="green" style={{ flex: 1 }}><Muted style={{ fontSize: 13 }}>Funded into escrow</Muted><Body>{money(d.totals.funded)} USDG</Body></Tile>
            <Tile tint="blue" style={{ flex: 1 }}><Muted style={{ fontSize: 13 }}>Paid to workers</Muted><Body>{money(d.totals.paidToWorkers)} USDG</Body></Tile>
          </View>
          {d.entries.length ? (
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {d.entries.map((e: any, i: number) => (
                <View key={i}>
                  <Row tint={e.direction === "payout" ? "blue" : "yellow"} icon={<ArrowUpRight size={18} color={color.navy} />} title={`${e.label} · ${e.amount} USDG`} detail={`${e.title ?? ""}${e.title ? " · " : ""}${day(e.at)}`} trailing={<StatusPill map={PAYOUT_STATUS} value={e.status} />} />
                  {e.transactionHash ? <View style={{ paddingLeft: 60, marginTop: -8, marginBottom: 6 }}><TxLink hash={e.transactionHash} explorer={explorer} /></View> : null}
                </View>
              ))}
            </Card>
          ) : <Empty mascot="fox" title="Nothing sent yet" text="Escrow you fund, payouts to your workers and tips you send show up here." />}
        </>
      ) : (
        <>
          <Muted>{d.entries.length} credited pieces of work from {d.distinctClients} client{d.distinctClients === 1 ? "" : "s"}. Share a selection as a verifiable link from the web.</Muted>
          {d.entries.length ? (
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {d.entries.map((e: any) => <Row key={`${e.kind}${e.ref}`} tint="purple" icon={<History size={18} color={color.navy} />} title={e.title} detail={`${e.client} · ${e.date}`} trailing={<Body style={{ fontSize: 14 }}>{e.amount}</Body>} />)}
            </Card>
          ) : <Empty mascot="robot" title="No credited work yet" text="Every approved job, task, milestone and pay period becomes part of your history." />}
          <Button kind="outline" title="Share my history on the web" onPress={() => openWeb(`${WEB}/app/earnings`)} />
        </>
      )}
    </Screen>
  );
}
