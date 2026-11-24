import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Briefcase, Gavel, ListChecks, Milestone, RefreshCcw, Sparkles } from "lucide-react-native";
import { account, gigs, jobs, reviews, tasks, contracts } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { greeting, money, shortAddress } from "../format";
import { buildNeeds } from "../needs";
import { color, font, mascots } from "../theme";
import { Body, Button, Card, Empty, ErrorBox, IconButton, Loading, Muted, Pill, Row, Screen, SectionHeader, Tile, openWeb } from "../ui";
import { UpdateBubble } from "./UpdateBubble";

const icons = { job: Briefcase, assignment: ListChecks, gig: Milestone, contract: Milestone, review: Gavel } as const;

export function Home() {
  const { session, profile, go, setTab } = useApp();
  const t = session.token;
  const data = useLoad(async () => {
    const settle = <T,>(p: Promise<T>) => p.catch(() => null as T | null);
    const [mine, assignments, myGigs, myContracts, payouts, myReviews, openJobs, openTasks, openGigs] = await Promise.all([
      jobs.mine(t), settle(tasks.assignments(t)), settle(gigs.mine(t)), settle(contracts.mine(t)), settle(account.payouts(t)),
      settle(reviews.me(t)), settle(jobs.ready()), settle(tasks.list()), settle(gigs.open()),
    ]);
    return { mine, assignments, myGigs, myContracts, payouts, myReviews, openJobs, openTasks, openGigs };
  }, [t]);
  const d = data.data;
  const needs = d ? buildNeeds({ wallet: session.walletAddress, jobs: d.mine, assignments: d.assignments ?? [], gigs: d.myGigs ?? [], contracts: d.myContracts ?? [], reviews: d.myReviews }) : [];
  const name = profile?.handle ?? session.handle ?? shortAddress(session.walletAddress);
  const active = needs.length;

  return (
    <Screen refreshing={data.refreshing} onRefresh={data.reload}>
      <View style={st.header}>
        <View style={st.avatar}><Image source={mascots.owl} style={{ width: 46, height: 46 }} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.hello}>{greeting()}</Text>
          <Muted numberOfLines={1}>{name}</Muted>
        </View>
        <View style={st.chip}><Sparkles size={14} color={color.navy} /><Text style={st.chipText}>{active}</Text></View>
        <IconButton size={42} label="Refresh" icon={<RefreshCcw size={18} color={color.navy} />} onPress={data.reload} />
      </View>

      <UpdateBubble />

      {/* Mascot peeking over the hero card, as in the layout reference. */}
      <View style={{ marginTop: 34 }}>
        <Image source={mascots.owl} style={st.peek} resizeMode="contain" />
        <View style={st.hero}>
          <Text style={st.heroLabel}>Paid to you</Text>
          <Text style={st.heroAmount}>{money(d?.payouts?.totals?.received)}<Text style={st.heroUnit}> USDG</Text></Text>
          <Text style={st.heroSub}>
            {d?.payouts?.totals?.pending && d.payouts.totals.pending !== "0" ? `${money(d.payouts.totals.pending)} on its way · ` : ""}
            {d?.payouts?.totals?.tips && d.payouts.totals.tips !== "0" ? `${money(d.payouts.totals.tips)} in tips` : "Straight to your wallet"}
          </Text>
          <View style={st.heroActions}>
            <Button kind="light" title="Find work" onPress={() => setTab("work")} style={{ flex: 1 }} small />
            <Button title="Pay & history" onPress={() => setTab("pay")} style={{ flex: 1 }} small />
          </View>
        </View>
      </View>

      <View style={st.bento}>
        <Tile tint="green" style={st.bentoTile} onPress={() => setTab("work")}>
          <Briefcase size={20} color={color.navy} />
          <Text style={st.bentoNumber}>{d?.openJobs?.length ?? "–"}</Text>
          <Muted style={{ fontSize: 13 }}>Funded jobs open</Muted>
        </Tile>
        <Tile tint="purple" style={st.bentoTile} onPress={() => setTab("work")}>
          <ListChecks size={20} color={color.navy} />
          <Text style={st.bentoNumber}>{d?.openTasks?.reduce((n: number, b: any) => n + (b.available ?? 0), 0) ?? "–"}</Text>
          <Muted style={{ fontSize: 13 }}>Quick tasks left</Muted>
        </Tile>
      </View>
      {d?.myReviews?.isReviewer ? (
        <Tile tint="navy">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[st.bentoTitle, { color: color.white }]}>Review cases</Text>
              <Text style={st.heroSub}>{d.myReviews.assigned.length ? `${d.myReviews.assigned.length} waiting for your decision` : `${d.myReviews.resolvedCount} decided so far`}</Text>
            </View>
            {d.myReviews.assigned.length ? <Button kind="light" small title="Decide" onPress={() => go({ kind: "review", id: d.myReviews.assigned[0].id })} /> : null}
          </View>
        </Tile>
      ) : null}

      <SectionHeader title="Needs you" action={needs.length > 4 ? "See posted" : undefined} onAction={() => setTab("posted")} />
      {data.error && !d ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <Loading /> : needs.length ? (
        <Card style={{ paddingVertical: 6, gap: 0 }}>
          {needs.slice(0, 8).map((n) => {
            const Icon = icons[(n.route?.kind ?? "job") as keyof typeof icons] ?? Briefcase;
            return (
              <Row key={n.key} tint={n.tint} icon={<Icon size={18} color={color.navy} />} title={n.title} detail={n.detail}
                onPress={() => (n.web ? openWeb(`${WEB}${n.web}`) : n.route && go(n.route))}
                trailing={<Pill label={n.action} tint={n.tint} />} />
            );
          })}
        </Card>
      ) : (
        <Empty title="You're all caught up" text="New work you claim, submissions to review and offers will show up here." action={<Button kind="outline" small title="Browse funded work" onPress={() => setTab("work")} />} />
      )}
      <Body style={{ fontSize: 12, color: color.muted, textAlign: "center" }}>Paired as {shortAddress(session.walletAddress)} · funding and tips happen on the web</Body>
    </Screen>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.green, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  hello: { fontFamily: font.sansMedium, fontSize: 18, color: color.navy },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: color.white, borderRadius: 999, paddingHorizontal: 12, height: 34, borderWidth: 1, borderColor: color.line },
  chipText: { fontFamily: font.mono, fontSize: 13, color: color.navy },
  peek: { position: "absolute", top: -64, alignSelf: "center", width: 120, height: 120, zIndex: 0 },
  hero: { backgroundColor: color.navy, borderRadius: 28, padding: 20, paddingTop: 26, alignItems: "center", gap: 6, zIndex: 1 },
  heroLabel: { fontFamily: font.sans, fontSize: 14, color: "#c9ccee" },
  heroAmount: { fontFamily: font.serif, fontSize: 44, color: color.white, letterSpacing: -1.5 },
  heroUnit: { fontFamily: font.mono, fontSize: 13, color: "#c9ccee" },
  heroSub: { fontFamily: font.sans, fontSize: 13, color: "#c9ccee", textAlign: "center" },
  heroActions: { flexDirection: "row", gap: 10, alignSelf: "stretch", marginTop: 10 },
  bento: { flexDirection: "row", gap: 12 },
  bentoTile: { flex: 1, minHeight: 130, justifyContent: "space-between" },
  bentoNumber: { fontFamily: font.serif, fontSize: 36, color: color.navy, letterSpacing: -1 },
  bentoTitle: { fontFamily: font.sansMedium, fontSize: 17, color: color.navy },
});
