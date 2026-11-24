import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Download } from "lucide-react-native";
import { color } from "../theme";
import { Body, Button, Muted, Notice } from "../ui";
import { CURRENT, REQUIRED, checkForUpdate, downloadApk, installApk, type UpdateDecision } from "../update";

/** Shown on Home when the published build for this app's channel is newer than the installed one. */
export function UpdateBubble() {
  const [decision, setDecision] = useState<UpdateDecision | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void checkForUpdate().then(setDecision); }, []);
  if (!decision || decision.state === CURRENT) return null;
  const m = decision.manifest;
  const size = m.sizeBytes ? ` · ${(m.sizeBytes / 1_048_576).toFixed(0)} MB` : "";

  async function update() {
    setError(""); setProgress(0);
    try {
      const file = await downloadApk(m, setProgress);
      setProgress(null);
      await installApk(file);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "The update couldn't be installed.");
    }
  }

  return (
    <Notice tint={decision.state === REQUIRED ? "coral" : "green"} icon={<Download size={18} color={color.navy} />}>
      <View style={{ gap: 6 }}>
        <Body style={{ fontSize: 15 }}>{decision.state === REQUIRED ? "This version is no longer supported. Please update." : `GigWork ${m.versionName} is ready${size}.`}</Body>
        {m.notes ? <Muted style={{ fontSize: 13 }}>{m.notes}</Muted> : null}
        <Muted style={{ fontSize: 12 }}>The file is checked against its published fingerprint first. Android then shows its own install screen, and the first time asks you to allow installs from GigWork.</Muted>
        {error ? <Body style={{ fontSize: 13, color: color.flame }}>{error}</Body> : null}
        <Button small title={progress === null ? "Update" : `Downloading ${Math.round(progress * 100)}%`} busy={progress !== null} onPress={update} />
      </View>
    </Notice>
  );
}
