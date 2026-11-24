// Write the version manifest published beside an APK (Tera's flow).
// Run by the workflow in the same job that built the APK, so the digest is of the exact file being uploaded.
// The document is checked with the same parseManifest the phone uses, so a manifest the app would refuse is never
// published. downloadUrl is filled in by the API from the release asset, so a manifest can't point elsewhere.
//
//   GIGWORK_CHANNEL=preview GIGWORK_VERSION_CODE=57 GIGWORK_MIN_SUPPORTED=1 GIGWORK_NOTES="..." \
//   node scripts/release-manifest.mjs <apk> <out.json>
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { CHANNELS, parseManifest } from "../src/update-core.js";

async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const whole = (value, name) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be a whole number, not "${text}".`);
  return Number(text);
};

const [apk, out] = process.argv.slice(2);
if (!apk || !out) throw new Error("Usage: release-manifest.mjs <apk> <out.json>");
const channel = process.env.GIGWORK_CHANNEL;
if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel)) throw new Error(`Unknown channel "${channel}".`);
const appJson = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const manifest = {
  platform: "android",
  channel,
  applicationId: CHANNELS[channel].applicationId,
  versionCode: whole(process.env.GIGWORK_VERSION_CODE, "The version code"),
  versionName: appJson.expo.version,
  minSupportedVersionCode: whole(process.env.GIGWORK_MIN_SUPPORTED || "1", "The minimum supported version code"),
  sha256: await digestFile(apk),
  notes: (process.env.GIGWORK_NOTES || "").split("\n")[0].trim().slice(0, 200) || `GigWork for Android, ${channel} build.`,
  publishedAt: new Date().toISOString(),
};
parseManifest({ ...manifest, downloadUrl: "https://github.com/" });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
