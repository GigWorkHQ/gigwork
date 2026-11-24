import React, { useState } from "react";
import { Alert, Share, View } from "react-native";
import { Gavel, Gift, LifeBuoy, LogOut, RefreshCcw, Smartphone, Wallet } from "lucide-react-native";
import { account, errorMessage } from "../api";
import { useApp, useLoad } from "../app";
import { WEB } from "../config";
import { shortAddress } from "../format";
import { color } from "../theme";
import { Body, Button, Card, Heading, Muted, Notice, Pill, Row, Screen, SectionHeader, Title, Mono, openWeb } from "../ui";
import { checkForUpdate, installedChannel, installedVersionCode, installedVersionName } from "../update";

export function Account() {
  const { session, profile, unpair, notify } = useApp();
  const t = session.token;
  const referrals = useLoad(() => account.referrals(t), [t]);
  const recoverable = useLoad(() => account.recoverable(t).catch(() => []), [t]);
  const [checking, setChecking] = useState(false);
  const r = referrals.data;

  async function claim(id: string) {
    try { await account.claimBonus(t, id); notify("Bonus claimed. It's on its way to your wallet."); referrals.reload(); }
    catch (e) { notify(errorMessage(e)); }
  }
  async function checkUpdate() {
    setChecking(true);
    const decision = await checkForUpdate();
    setChecking(false);
    notify(!decision ? "Couldn't check for updates right now." : decision.state === "current" ? "You're on the latest version." : `Version ${decision.manifest.versionName} is ready. Open Home to update.`);
  }
  function confirmUnpair() {
    Alert.alert("Unpair this phone?", "The app signs out of your GigWork account. Your account, work and pay are untouched, and you can pair again with a new code from the web.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unpair", style: "destructive", onPress: () => void unpair() },
    ]);
  }

  return (
    <Screen refreshing={referrals.refreshing} onRefresh={() => { referrals.reload(); recoverable.reload(); }}>
      <Title>Account</Title>
      <Card>
        <Row tint="green" icon={<Wallet size={18} color={color.navy} />} title={profile?.handle ?? "No pay handle yet"} detail={shortAddress(session.walletAddress)}
          trailing={profile?.isReviewer ? <Pill label="Reviewer" tint="purple" /> : undefined} />
        <Muted style={{ fontSize: 13 }}>This phone is paired to the wallet above. Pay always goes to that wallet. Set or change your pay handle, payout choice and API keys on the web.</Muted>
        <Button kind="outline" small title="Account settings on the web" onPress={() => openWeb(`${WEB}/app/account`)} />
      </Card>

      {profile?.isReviewer ? <Notice tint="purple" icon={<Gavel size={18} color={color.navy} />}>You're an independent reviewer. Cases drawn to you show on Home under Needs you.</Notice> : null}

      {recoverable.data && recoverable.data.length > 0 ? (
        <Notice tint="coral" icon={<LifeBuoy size={18} color={color.navy} />}>
          <Body style={{ fontSize: 14 }}>{recoverable.data.length} of your escrows hold USDG nobody is owed. Return it to your wallet from the web.</Body>
          <Button small kind="outline" title="Recover on the web" onPress={() => openWeb(`${WEB}/app/account`)} style={{ marginTop: 8 }} />
        </Notice>
      ) : null}

      <SectionHeader title="Referrals" />
      {r ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Gift size={20} color={color.navy} />
            <Heading style={{ fontSize: 22, flex: 1 }}>{r.code}</Heading>
            <Button small kind="navy" title="Share" onPress={() => void Share.share({ message: `Join me on GigWork — funded work, paid in USDG: ${WEB}/app/account?ref=${r.code}` })} />
          </View>
          <Muted style={{ fontSize: 13 }}>{r.invitees.length}/{r.program.maxInvites} invites used. You and your invitee each get {r.program.bonus} USDG once they finish {r.program.minApproved} pieces of qualifying work and the team reviews it.</Muted>
          {r.myProgress ? <Mono>Your progress: {r.myProgress.approved}/{r.program.minApproved} pieces · {r.myProgress.clients}/{r.program.minClients} clients</Mono> : null}
          {r.bonuses.map((b: any) => (
            <Row key={b.id} tint="pink" icon={<Gift size={18} color={color.navy} />} title={`${b.role === "referrer" ? "Referral" : "Welcome"} bonus · ${b.amount} USDG`}
              detail={b.status === "pending_review" ? "Waiting for team review" : b.status === "rejected" ? "Not approved" : b.status === "claimable" ? "Ready to claim" : b.payoutStatus === "complete" ? "Paid" : "Sending"}
              trailing={b.status === "claimable" ? <Button small title="Claim" onPress={() => claim(b.id)} /> : undefined} />
          ))}
        </Card>
      ) : null}

      <SectionHeader title="This phone" />
      <Card>
        <Row tint="blue" icon={<Smartphone size={18} color={color.navy} />} title={`GigWork ${installedVersionName() || ""}`.trim()} detail={`Build ${installedVersionCode() ?? "?"} · ${installedChannel() ?? "local"} channel`}
          trailing={<Button small kind="outline" title={checking ? "Checking…" : "Check"} busy={checking} icon={checking ? undefined : <RefreshCcw size={14} color={color.navy} />} onPress={checkUpdate} />} />
        <Button kind="outline" title="Unpair this phone" icon={<LogOut size={16} color={color.navy} />} onPress={confirmUnpair} />
      </Card>
    </Screen>
  );
}
