import React, { type ReactNode } from "react";
import {
  ActivityIndicator, Image, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import { color, font, mascots, radius, tone, type Tone } from "./theme";

// ---------- type ----------

type TP = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean };
export const Title = ({ children, style, numberOfLines }: TP) => <Text numberOfLines={numberOfLines} style={[s.title, style]}>{children}</Text>;
export const Heading = ({ children, style, numberOfLines }: TP) => <Text numberOfLines={numberOfLines} style={[s.heading, style]}>{children}</Text>;
export const Body = ({ children, style, numberOfLines, selectable }: TP) => <Text selectable={selectable} numberOfLines={numberOfLines} style={[s.body, style]}>{children}</Text>;
export const Muted = ({ children, style, numberOfLines }: TP) => <Text numberOfLines={numberOfLines} style={[s.body, s.muted, style]}>{children}</Text>;
export const Mono = ({ children, style, numberOfLines, selectable }: TP) => <Text selectable={selectable} numberOfLines={numberOfLines} style={[s.mono, style]}>{children}</Text>;

/** "1,230.50" with the cents smaller, like the balance figures in the layout reference. */
export function Amount({ value, unit = "USDG", size = 40, light = false }: { value: string; unit?: string; size?: number; light?: boolean }) {
  const [whole, cents] = String(value).split(".");
  const ink = light ? color.white : color.navy;
  return (
    <Text style={{ fontFamily: font.serif, fontSize: size, color: ink, letterSpacing: -1 }}>
      {Number(whole).toLocaleString("en-US")}
      {cents ? <Text style={{ fontSize: size * 0.55, color: light ? "#ffffffaa" : color.muted }}>.{cents}</Text> : null}
      <Text style={{ fontFamily: font.mono, fontSize: Math.max(11, size * 0.28), color: light ? "#ffffffaa" : color.muted }}> {unit}</Text>
    </Text>
  );
}

// ---------- buttons ----------

type ButtonKind = "flame" | "navy" | "outline" | "light" | "ghost";
export function Button({ title, onPress, kind = "flame", icon, busy, disabled, small, style }: {
  title: string; onPress?: () => void; kind?: ButtonKind; icon?: ReactNode; busy?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const palette = {
    flame: { bg: color.flame, fg: color.white, border: color.flame, down: color.flameDown },
    navy: { bg: color.navy, fg: color.white, border: color.navy, down: color.navySoft },
    outline: { bg: "transparent", fg: color.navy, border: "#8b8c9a", down: "#00063d10" },
    light: { bg: color.white, fg: color.navy, border: color.white, down: color.paper },
    ghost: { bg: "transparent", fg: color.white, border: "#ffffff66", down: "#ffffff14" },
  }[kind];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onPress?.(); }}
      style={({ pressed }) => [s.button, small && s.buttonSmall, { backgroundColor: pressed ? palette.down : palette.bg, borderColor: palette.border, opacity: off ? 0.5 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={palette.fg} /> : icon}
      <Text style={[s.buttonText, small && { fontSize: 13 }, { color: palette.fg }]}>{title}</Text>
    </Pressable>
  );
}

/** Round icon button, as in the layout reference's header. */
export function IconButton({ icon, onPress, label, dark = false, size = 48 }: { icon: ReactNode; onPress?: () => void; label: string; dark?: boolean; size?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [s.iconButton, { width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? (pressed ? color.navySoft : color.navy) : pressed ? color.paper : color.white, borderColor: dark ? color.navy : color.line }]}>
      {icon}
    </Pressable>
  );
}

/** Small text link for secondary actions. */
export const Link = ({ title, onPress, style }: { title: string; onPress: () => void; style?: StyleProp<TextStyle> }) => (
  <Text accessibilityRole="link" onPress={onPress} style={[s.link, style]}>{title}</Text>
);

export const openWeb = (url: string) => { void Linking.openURL(url); };

// ---------- surfaces ----------

export const Card = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.card, style]}>{children}</View>;
export const Tile = ({ children, tint = "green", style, onPress }: { children: ReactNode; tint?: Tone | "navy" | "white"; style?: StyleProp<ViewStyle>; onPress?: () => void }) => {
  const bg = tint === "navy" ? color.navy : tint === "white" ? color.white : tone[tint];
  const body = <View style={[s.tile, { backgroundColor: bg, borderColor: tint === "white" ? color.line : bg }, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, flex: (StyleSheet.flatten(style) as ViewStyle)?.flex })}>{body}</Pressable> : body;
};

/** Mono status pill. Colours come from the web's own status maps (src/live.js), so both surfaces say the same thing. */
export function Pill({ label, tint = "blue" }: { label: string; tint?: string }) {
  const bg = (tone as Record<string, string>)[tint] ?? color.blue;
  return <View style={[s.pill, { backgroundColor: bg }]}><Text style={s.pillText}>{label.toUpperCase()}</Text></View>;
}
export function StatusPill({ map, value }: { map: Record<string, readonly string[]>; value: string }) {
  const [label, tint] = map[value] ?? [value.replace(/_/g, " "), "blue"];
  return <Pill label={label} tint={tint} />;
}

export function Notice({ children, tint = "blue", icon }: { children: ReactNode; tint?: Tone; icon?: ReactNode }) {
  return <View style={[s.notice, { backgroundColor: tone[tint] }]}>{icon}<View style={{ flex: 1 }}>{typeof children === "string" ? <Body style={{ fontSize: 14 }}>{children}</Body> : children}</View></View>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.segmented}>
      {options.map(([key, label]) => {
        const on = key === value;
        return (
          <Pressable key={key} onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onChange(key); }} style={[s.segment, on && s.segmentOn]}>
            <Text style={[s.segmentText, on && { color: color.white }]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A list row: tinted icon disc, title and detail, and a trailing element (a pill, an amount or an action). */
export function Row({ icon, tint = "green", title, detail, trailing, onPress }: { icon?: ReactNode; tint?: Tone; title: string; detail?: string; trailing?: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: color.paper }]}>
      {icon ? <View style={[s.rowIcon, { backgroundColor: tone[tint] }]}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Body numberOfLines={2} style={{ fontFamily: font.sansMedium }}>{title}</Body>
        {detail ? <Muted numberOfLines={2} style={{ fontSize: 13 }}>{detail}</Muted> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.sectionHeader}>
      <Heading style={{ fontSize: 22 }}>{title}</Heading>
      {action && onAction ? <Link title={action} onPress={onAction} /> : null}
    </View>
  );
}

export function Empty({ title, text, mascot = "owl", action }: { title: string; text?: string; mascot?: keyof typeof mascots; action?: ReactNode }) {
  return (
    <View style={s.empty}>
      <Image source={mascots[mascot]} style={{ width: 96, height: 96 }} resizeMode="contain" />
      <Heading style={{ fontSize: 20, textAlign: "center" }}>{title}</Heading>
      {text ? <Muted style={{ textAlign: "center" }}>{text}</Muted> : null}
      {action}
    </View>
  );
}

export function Loading() {
  return <View style={s.empty}><ActivityIndicator color={color.navy} /></View>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice tint="coral">
      <Body style={{ fontSize: 14 }}>{message}</Body>
      {onRetry ? <Link title="Try again" onPress={onRetry} style={{ marginTop: 6 }} /> : null}
    </Notice>
  );
}

// ---------- layout ----------

export function Screen({ children, refreshing, onRefresh, bottomInset = 120, background = color.paper }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; bottomInset?: number; background?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: background }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + bottomInset, paddingHorizontal: 18, gap: 16 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.navy} colors={[color.flame]} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Field({ label, value, onChangeText, placeholder, multiline, hint, error, autoCapitalize = "sentences", maxLength }: {
  label: string; value: string; onChangeText: (text: string) => void; placeholder?: string; multiline?: boolean; hint?: string; error?: string;
  autoCapitalize?: "none" | "sentences" | "characters" | "words"; maxLength?: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={color.faint}
        multiline={multiline} autoCapitalize={autoCapitalize} maxLength={maxLength}
        style={[s.input, multiline && { minHeight: 110, textAlignVertical: "top" }, !!error && { borderColor: color.flame }]}
      />
      {error ? <Text style={[s.hint, { color: color.flame }]}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Bottom sheet for an action that needs some text: submit work, request changes, open a dispute. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 18 }]}>
        <View style={s.sheetHeader}>
          <Heading style={{ fontSize: 22, flex: 1 }}>{title}</Heading>
          <IconButton size={40} label="Close" icon={<X size={18} color={color.navy} />} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: font.serif, fontSize: 34, lineHeight: 38, color: color.navy, letterSpacing: -1 },
  heading: { fontFamily: font.serif, fontSize: 26, lineHeight: 30, color: color.navy, letterSpacing: -0.6 },
  body: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, color: color.navy },
  muted: { color: color.muted },
  mono: { fontFamily: font.mono, fontSize: 12, color: color.muted, letterSpacing: 0.3 },
  link: { fontFamily: font.sansMedium, fontSize: 14, color: color.flame },
  button: { minHeight: 52, borderRadius: radius.button, borderWidth: 1, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  buttonSmall: { minHeight: 38, paddingHorizontal: 14, borderRadius: 12 },
  buttonText: { fontFamily: font.sansMedium, fontSize: 16 },
  iconButton: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  card: { backgroundColor: color.white, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, padding: 18, gap: 12 },
  tile: { borderRadius: radius.tile, borderWidth: 1, padding: 16, gap: 8 },
  pill: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "#00063d10" },
  pillText: { fontFamily: font.mono, fontSize: 10, color: color.navy, letterSpacing: 0.4 },
  notice: { flexDirection: "row", gap: 10, borderRadius: 16, padding: 14, alignItems: "flex-start" },
  segmented: { backgroundColor: color.white, borderRadius: radius.pill, padding: 4, gap: 4, borderWidth: 1, borderColor: color.line },
  segment: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  segmentOn: { backgroundColor: color.navy },
  segmentText: { fontFamily: font.sansMedium, fontSize: 14, color: color.navy },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 14 },
  rowIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 28, paddingHorizontal: 12 },
  label: { fontFamily: font.mono, fontSize: 11, color: color.muted, letterSpacing: 0.6, textTransform: "uppercase" },
  input: { fontFamily: font.sans, fontSize: 16, color: color.navy, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  hint: { fontFamily: font.sans, fontSize: 12, color: color.muted },
  scrim: { flex: 1, backgroundColor: "#00063d66" },
  sheet: { backgroundColor: color.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, maxHeight: "88%", gap: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
});

/** Link to a transaction on the chain explorer. */
export function TxLink({ hash, explorer, label = "View on explorer" }: { hash?: string | null; explorer?: string; label?: string }) {
  if (!hash) return null;
  return <Link title={label} onPress={() => openWeb(`${explorer ?? "https://robinhoodchain.blockscout.com"}/tx/${hash}`)} style={{ fontSize: 13 }} />;
}
