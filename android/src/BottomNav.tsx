import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Briefcase, Home, Megaphone, UserRound, Wallet } from "lucide-react-native";
import type { Tab } from "./app";
import { color, font } from "./theme";

const TABS: [Tab, string, typeof Home][] = [["home", "Home", Home], ["work", "Work", Briefcase], ["posted", "Posted", Megaphone], ["pay", "Pay", Wallet], ["account", "Account", UserRound]];

/** Floating pill navigation from the layout reference: the active tab is a filled navy disc. */
export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[st.wrap, { bottom: insets.bottom + 14 }]}>
      <View style={st.bar} accessibilityRole="tablist">
        {TABS.map(([key, label, Icon]) => {
          const on = key === tab;
          return (
            <Pressable key={key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }}
              onPress={() => { if (!on) void Haptics.selectionAsync().catch(() => undefined); onChange(key); }} style={st.item} hitSlop={4}>
              <View style={[st.disc, on && st.discOn]}><Icon size={21} color={on ? color.white : color.navy} strokeWidth={on ? 2.2 : 1.8} /></View>
              <Text style={[st.label, on && { color: color.navy }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  bar: { flexDirection: "row", backgroundColor: color.white, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8, gap: 4, borderWidth: 1, borderColor: color.line, elevation: 10, shadowColor: color.navy, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  item: { alignItems: "center", width: 62, gap: 2 },
  disc: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  discOn: { backgroundColor: color.navy },
  label: { fontFamily: font.mono, fontSize: 10, color: color.faint },
});
