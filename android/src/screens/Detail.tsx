import React, { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { errorMessage } from "../api";
import { useApp } from "../app";
import { color } from "../theme";
import { Button, Field, IconButton, Muted, Notice, Screen, Sheet, Title } from "../ui";

/** Common frame for an item page: back button, title, status, then the body. */
export function DetailScreen({ title, status, children, refreshing, onRefresh }: { title?: string; status?: ReactNode; children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const { back } = useApp();
  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} bottomInset={40}>
      <IconButton label="Back" icon={<ArrowLeft size={20} color={color.navy} />} onPress={back} />
      {title ? <Title style={{ fontSize: 30, lineHeight: 34 }}>{title}</Title> : null}
      {status}
      {children}
    </Screen>
  );
}

/** Run one action at a time, toast the result, reload the page. */
export function useAct(reload: () => void) {
  const { notify } = useApp();
  const busy = useRef(false);
  const [running, setRunning] = useState<string | null>(null);
  async function act(key: string, fn: () => Promise<unknown>, message: string) {
    if (busy.current) return false;
    busy.current = true; setRunning(key);
    try { await fn(); notify(message); reload(); return true; }
    catch (e) { notify(errorMessage(e)); return false; }
    finally { busy.current = false; setRunning(null); }
  }
  return { act, running };
}

/** A sheet with text fields and one submit button. Errors from the server stay in the sheet. */
export function TextSheet({ visible, title, intro, fields, submit, onClose, onSubmit }: {
  visible: boolean; title: string; intro?: string; submit: string; onClose: () => void;
  fields: { key: string; label: string; placeholder?: string; multiline?: boolean; hint?: string; min?: number }[];
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = fields.every((f) => (values[f.key] ?? "").trim().length >= (f.min ?? 1) || f.min === 0);
  async function send() {
    setBusy(true); setError("");
    try { await onSubmit(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? "").trim()]))); setValues({}); onClose(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {intro ? <Muted>{intro}</Muted> : null}
      {fields.map((f) => (
        <Field key={f.key} label={f.label} placeholder={f.placeholder} multiline={f.multiline} hint={f.hint}
          value={values[f.key] ?? ""} onChangeText={(text) => setValues((v) => ({ ...v, [f.key]: text }))} />
      ))}
      {error ? <Notice tint="coral">{error}</Notice> : null}
      <View><Button title={busy ? "Sending…" : submit} busy={busy} disabled={!ready} onPress={send} /></View>
    </Sheet>
  );
}
