import React from "react";
import { Alert, View } from "react-native";
import { CONTRACT_STATUS, PERIOD_STATUS } from "../../../src/live.js";
import { contracts } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { day, party } from "../format";
import { Amount, Body, Button, Card, ErrorBox, Heading, Loading, Muted, Notice, StatusPill, openWeb } from "../ui";
import { DetailScreen, useAct } from "./Detail";

export function ContractDetail({ id }: { id: string }) {
  const { session } = useApp();
  const t = session.token;
  const load = useLoad(() => contracts.get(t, id), [id, t]);
  const { act, running } = useAct(load.reload);
  if (load.error && !load.data) return <DetailScreen><ErrorBox message={load.error} onRetry={load.reload} /></DetailScreen>;
  if (!load.data) return <DetailScreen><Loading /></DetailScreen>;
  const c = load.data;
  const worker = c.role === "worker";
  const end = () => Alert.alert("End this contract?", "Periods already under way are still paid. Future reserved periods are refunded to the client.", [
    { text: "Keep it", style: "cancel" },
    { text: "End contract", style: "destructive", onPress: () => void act("end", () => contracts.end(t, id), "Contract ended.") },
  ]);

  return (
    <DetailScreen title={c.title} status={<StatusPill map={CONTRACT_STATUS} value={c.status} />} refreshing={load.refreshing} onRefresh={load.reload}>
      <Card>
        <Amount value={c.rate} size={34} unit={`USDG / ${c.periodDays} days`} />
        <Muted style={{ fontSize: 13 }}>Client {party(c.client)} · worker {party(c.worker)}{c.startsAt ? ` · since ${day(c.startsAt)}` : ""}</Muted>
        <Body selectable>{c.description}</Body>
      </Card>
      {worker && c.status === "offered" ? (
        <View style={{ gap: 10 }}>
          <Button title="Accept the contract" busy={running === "accept"} onPress={() => act("accept", () => contracts.accept(t, id), "Accepted. Each period is reserved in escrow before it starts.")} />
          <Button kind="outline" title="Decline" busy={running === "decline"} onPress={() => act("decline", () => contracts.decline(t, id), "Declined.")} />
        </View>
      ) : null}
      {c.proposedRate && c.status === "active" ? (worker ? (
        <Notice tint="yellow">
          <Body style={{ fontSize: 14 }}>The client proposed a new rate of {c.proposedRate} USDG per period, from the next period on. It only applies if you accept.</Body>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Button small title="Accept rate" style={{ flex: 1 }} busy={running === "rate-yes"} onPress={() => act("rate-yes", () => contracts.respondRate(t, id, true), "New rate accepted.")} />
            <Button small kind="outline" title="Keep current" style={{ flex: 1 }} busy={running === "rate-no"} onPress={() => act("rate-no", () => contracts.respondRate(t, id, false), "You kept the current rate.")} />
          </View>
        </Notice>
      ) : <Notice tint="yellow">{`You proposed ${c.proposedRate} USDG. It applies once the worker accepts.`}</Notice>) : null}
      {!worker && c.status === "active" && c.nextPeriod ? (
        <Notice tint="green">
          <Body style={{ fontSize: 14 }}>Next period: {day(c.nextPeriod.startsAt)} – {day(c.nextPeriod.endsAt)}, {c.nextPeriod.amount} USDG. Reserve it in escrow from the web, with your wallet.</Body>
          <Button small title="Reserve on the web" onPress={() => openWeb(`${WEB}/app/payruns?as=client&open=${c.id}`)} style={{ marginTop: 8 }} />
        </Notice>
      ) : null}
      <Heading style={{ fontSize: 22 }}>Pay periods</Heading>
      {c.periods.length ? c.periods.map((p: any) => (
        <Card key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Body>Period {p.number} · {p.amount} USDG</Body>
            <Muted style={{ fontSize: 13 }}>{day(p.startsAt)} – {day(p.endsAt)}</Muted>
          </View>
          <StatusPill map={PERIOD_STATUS} value={p.status} />
        </Card>
      )) : <Muted>No periods reserved yet. Each period is reserved in escrow before it starts and paid when it ends.</Muted>}
      {c.status === "active" ? <Button kind="outline" title="End contract" busy={running === "end"} onPress={end} /> : null}
    </DetailScreen>
  );
}
