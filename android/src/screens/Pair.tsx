import React, { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { errorMessage, pairing } from "../api";
import { WEB } from "../config";
import { saveSession, type Session } from "../session";
import { color, font } from "../theme";
import { Body, Button, Card, IconButton, Mono, Muted, Notice, Screen, Title, openWeb } from "../ui";

const ALPHABET = /[ABCDEFGHJKMNPQRSTUVWXYZ23456789]/;

/** The phone sends the code from the web and gets a device session for that account. No wallet, no keys. */
export function Pair({ onBack, onPaired }: { onBack: () => void; onPaired: (session: Session) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<TextInput>(null);
  const clean = (text: string) => [...text.toUpperCase()].filter((c) => ALPHABET.test(c)).join("").slice(0, 8);

  async function pair() {
    if (busy || code.length !== 8) return;
    setBusy(true); setError("");
    try {
      const model = (Platform.constants as { Model?: string }).Model;
      const result = await pairing.redeem(code, (model || "Android phone").slice(0, 60));
      const session: Session = { token: result.token, expiresAt: result.expiresAt, sessionId: result.sessionId, walletAddress: result.walletAddress, handle: result.handle };
      await saveSession(session);
      onPaired(session);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen bottomInset={40}>
      <IconButton label="Back" icon={<ArrowLeft size={20} color={color.navy} />} onPress={onBack} />
      <Title>Pair with{"\n"}the web</Title>
      <Muted>GigWork for Android works as your web account. It never holds your wallet.</Muted>
      <Card>
        {[["1", "On a computer, open gigworkhq.com and sign in with your wallet."], ["2", "Go to Account and tap Get a pairing code."], ["3", "Type the 8-character code here. It works once, for 10 minutes."]].map(([n, text]) => (
          <View key={n} style={st.step}><View style={st.stepNumber}><Text style={st.stepText}>{n}</Text></View><Body style={{ flex: 1 }}>{text}</Body></View>
        ))}
      </Card>
      <Pressable onPress={() => input.current?.focus()} accessibilityLabel="Pairing code" style={st.boxes}>
        {Array.from({ length: 8 }, (_, i) => (
          <React.Fragment key={i}>
            {i === 4 ? <Text style={st.dash}>–</Text> : null}
            <View style={[st.box, i === code.length && st.boxActive]}><Text style={st.boxText}>{code[i] ?? ""}</Text></View>
          </React.Fragment>
        ))}
      </Pressable>
      <TextInput
        ref={input} value={code} onChangeText={(t) => { setCode(clean(t)); setError(""); }} autoFocus autoCapitalize="characters" autoCorrect={false}
        maxLength={12} style={st.hidden} onSubmitEditing={pair} returnKeyType="done"
      />
      {error ? <Notice tint="coral">{error}</Notice> : null}
      <Button title={busy ? "Pairing…" : "Pair this phone"} busy={busy} disabled={code.length !== 8} onPress={pair} />
      <Button kind="outline" title="Open GigWork on the web" onPress={() => openWeb(`${WEB}/app/account`)} />
      <Mono style={{ textAlign: "center" }}>You can remove this phone any time from Account on the web.</Mono>
    </Screen>
  );
}

const st = StyleSheet.create({
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNumber: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.green, alignItems: "center", justifyContent: "center" },
  stepText: { fontFamily: font.mono, fontSize: 12, color: color.navy },
  boxes: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginVertical: 6 },
  box: { width: 36, height: 48, borderRadius: 10, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, alignItems: "center", justifyContent: "center" },
  boxActive: { borderColor: color.navy, borderWidth: 2 },
  boxText: { fontFamily: font.mono, fontSize: 20, color: color.navy },
  dash: { fontFamily: font.mono, fontSize: 20, color: color.muted },
  hidden: { position: "absolute", opacity: 0, height: 1, width: 1 },
});
