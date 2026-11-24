import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, BackHandler, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useFonts } from "expo-font";
import { account, onSessionExpired, pairing } from "./src/api";
import { AppContext, type AppState, type Route, type Tab } from "./src/app";
import { BottomNav } from "./src/BottomNav";
import { clearSession, loadSession, type Session } from "./src/session";
import { color, font, fontFiles } from "./src/theme";
import { Account } from "./src/screens/Account";
import { ContractDetail } from "./src/screens/ContractDetail";
import { GigDetail } from "./src/screens/GigDetail";
import { Home } from "./src/screens/Home";
import { JobDetail } from "./src/screens/JobDetail";
import { Onboarding } from "./src/screens/Onboarding";
import { Pair } from "./src/screens/Pair";
import { Pay } from "./src/screens/Pay";
import { Posted } from "./src/screens/Posted";
import { ReviewCase } from "./src/screens/ReviewCase";
import { Assignment, BatchDetail, TaskBatch } from "./src/screens/Tasks";
import { Work } from "./src/screens/Work";

export default function App() {
  const [fontsLoaded] = useFonts(fontFiles);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [pairing_, setPairing] = useState(false);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(color.paper); void loadSession().then(setSession); }, []);

  if (!fontsLoaded || session === undefined)
    return <View style={{ flex: 1, backgroundColor: color.navy, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={color.green} /></View>;

  return (
    <SafeAreaProvider>
      {session ? (
        <Paired session={session} onUnpaired={() => { setSession(null); setPairing(false); }} />
      ) : pairing_ ? (
        <><StatusBar style="dark" /><Pair onBack={() => setPairing(false)} onPaired={setSession} /></>
      ) : (
        <><StatusBar style="light" /><Onboarding onPair={() => setPairing(true)} /></>
      )}
    </SafeAreaProvider>
  );
}

function Paired({ session, onUnpaired }: { session: Session; onUnpaired: () => void }) {
  const [tab, setTab] = useState<Tab>("home");
  const [stack, setStack] = useState<Route[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [toast, setToast] = useState("");
  const fade = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forget = useCallback(async () => { await clearSession(); onUnpaired(); }, [onUnpaired]);
  // Removed on the web, or expired: drop the session and go back to onboarding.
  useEffect(() => { onSessionExpired(() => void forget()); }, [forget]);
  const reloadProfile = useCallback(() => { void account.me(session.token).then(setProfile).catch(() => undefined); }, [session.token]);
  useEffect(reloadProfile, [reloadProfile]);

  const notify = useCallback((message: string) => {
    setToast(message);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToast("")), 3600);
  }, [fade]);

  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length) { back(); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, back]);

  const state: AppState = {
    session, profile, reloadProfile, notify,
    go: (route) => setStack((s) => [...s, route]),
    back,
    setTab: (next) => { setStack([]); setTab(next); },
    unpair: async () => {
      await pairing.unpair(session.token, session.sessionId).catch(() => undefined);
      await forget();
    },
  };
  const top = stack[stack.length - 1];

  return (
    <AppContext.Provider value={state}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: color.paper }}>
        {top ? <RouteScreen key={stack.length} route={top} /> : (
          <>
            {tab === "home" && <Home />}
            {tab === "work" && <Work />}
            {tab === "posted" && <Posted />}
            {tab === "pay" && <Pay />}
            {tab === "account" && <Account />}
          </>
        )}
        {!top ? <BottomNav tab={tab} onChange={state.setTab} /> : null}
        {toast ? (
          <Animated.View pointerEvents="none" style={{ position: "absolute", left: 18, right: 18, bottom: top ? 30 : 110, opacity: fade, backgroundColor: color.navy, borderRadius: 16, padding: 14 }}>
            <Text style={{ color: color.white, fontFamily: font.sans, fontSize: 14 }}>{toast}</Text>
          </Animated.View>
        ) : null}
      </View>
    </AppContext.Provider>
  );
}

function RouteScreen({ route }: { route: Route }) {
  switch (route.kind) {
    case "job": return <JobDetail id={route.id} />;
    case "assignment": return <Assignment id={route.id} />;
    case "taskBatch": return <TaskBatch batch={route.batch} />;
    case "batch": return <BatchDetail id={route.id} />;
    case "gig": return <GigDetail id={route.id} />;
    case "contract": return <ContractDetail id={route.id} />;
    case "review": return <ReviewCase id={route.id} />;
  }
}
