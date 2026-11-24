import React, { useRef, useState } from "react";
import { Image, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEB } from "../config";
import { color, font, mascots } from "../theme";
import { Button, openWeb } from "../ui";

// Layout after the onboarding reference: full-bleed deep background, a big headline and a soft subtitle, the hero
// illustration (GigWork's felt mascots), pill page dots, then a filled and an outlined button.
const SLIDES = [
  { mascot: mascots.owl, glow: color.green, title: "Funded before\nyou start", text: "Every job, quick task and gig is paid into escrow first. If it's listed, the money is there." },
  { mascot: mascots.fox, glow: color.coral, title: "Paid when\nit's approved", text: "Approved work is paid in USDG on Robinhood Chain, straight to the wallet you use on the web." },
  { mascot: mascots.robot, glow: color.purple, title: "Your account,\nin your pocket", text: "Claim work, submit, review and release from your phone. The app pairs with your web account; your wallet stays where it is." },
];

export function Onboarding({ onPair }: { onPair: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const pager = useRef<ScrollView>(null);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width));

  return (
    <LinearGradient colors={["#2a2f8f", color.navy, "#000322"]} locations={[0, 0.45, 1]} style={{ flex: 1 }}>
      <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} style={{ flex: 1 }}>
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[st.slide, { width, paddingTop: insets.top + 36 }]}>
            <Text style={st.title}>{slide.title}</Text>
            <Text style={st.text}>{slide.text}</Text>
            <View style={st.art}>
              <View style={[st.glow, { backgroundColor: slide.glow }]} />
              <View style={st.ring} />
              <Image source={slide.mascot} style={st.mascot} resizeMode="contain" accessibilityIgnoresInvertColors />
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={[st.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={st.dots} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
          {SLIDES.map((slide, i) => <View key={slide.title} style={[st.dot, i === index && st.dotOn]} />)}
        </View>
        <Button kind="light" title="Pair with the web" onPress={onPair} />
        <Button kind="ghost" title="Create an account on the web" onPress={() => openWeb(`${WEB}/app/overview`)} />
        <Text style={st.small}>New to GigWork? Make your account on the web first, then pair this phone from Account.</Text>
      </View>
    </LinearGradient>
  );
}

const st = StyleSheet.create({
  slide: { paddingHorizontal: 28, alignItems: "center" },
  title: { fontFamily: font.serif, fontSize: 40, lineHeight: 42, color: color.white, textAlign: "center", letterSpacing: -1.2 },
  text: { fontFamily: font.sans, fontSize: 16, lineHeight: 23, color: "#b9bde6", textAlign: "center", marginTop: 14, maxWidth: 330 },
  art: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center", minHeight: 260 },
  glow: { position: "absolute", width: 230, height: 230, borderRadius: 115, opacity: 0.22 },
  ring: { position: "absolute", width: 300, height: 300, borderRadius: 150, borderWidth: 1, borderColor: "#ffffff22" },
  mascot: { width: 250, height: 250 },
  footer: { paddingHorizontal: 24, gap: 12 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ffffff55" },
  dotOn: { width: 30, backgroundColor: color.white },
  small: { fontFamily: font.sans, fontSize: 12, lineHeight: 17, color: "#9ea3d6", textAlign: "center", marginTop: 4 },
});
