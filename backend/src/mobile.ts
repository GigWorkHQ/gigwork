import { Router, type Request, type Response } from "express";

// Where the Android companion app is downloaded from, and what an installed app is told about updates.
// Same design as Tera's: the build workflow publishes the APK and a version manifest (with the APK's SHA-256, computed
// in the run that built it) to a GitHub release. This service only reads that release. It fills in the download URL
// and size from the release asset itself, so a manifest can never point a phone at another file, and the phone checks
// the digest before handing the file to Android's installer.

export class UpdateError extends Error {}
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{64}$/i.test(value);

const REPOSITORY = "gigworkhq/gigwork";
const CACHE_MS = 5 * 60_000;

// Each channel is its own Android app (its own application ID, signing key and release); neither may be handed the
// other's file, or the phone would install a second app instead of updating the first.
export const channels = {
  preview: { releaseTag: "android-preview", assetName: "gigwork-android-preview.apk", manifestName: "gigwork-android-preview.json", applicationId: "com.gigworkhq.android.preview" },
  production: { releaseTag: "android-production", assetName: "gigwork-android.apk", manifestName: "gigwork-android.json", applicationId: "com.gigworkhq.android" },
} as const;
export type Channel = keyof typeof channels;
const isChannel = (value: unknown): value is Channel => typeof value === "string" && Object.prototype.hasOwnProperty.call(channels, value);

export function parseManifest(input: unknown) {
  const doc = input as any;
  if (!doc || typeof doc !== "object") throw new UpdateError("This is not a readable manifest.");
  if (doc.platform !== "android") throw new UpdateError("This manifest is not for Android.");
  if (!isCount(doc.versionCode)) throw new UpdateError("The manifest has no version code.");
  if (!isCount(doc.minSupportedVersionCode)) throw new UpdateError("The manifest has no supported floor.");
  if (doc.minSupportedVersionCode > doc.versionCode) throw new UpdateError("The manifest requires a version newer than the one it publishes.");
  if (typeof doc.versionName !== "string" || !doc.versionName) throw new UpdateError("The manifest has no version name.");
  if (!isSha256(doc.sha256)) throw new UpdateError("The manifest does not say what the download should hash to.");
  if (typeof doc.downloadUrl !== "string" || !/^https:\/\//.test(doc.downloadUrl)) throw new UpdateError("The manifest has no https download.");
  if (!isChannel(doc.channel)) throw new UpdateError("The manifest names an unknown channel.");
  if (doc.applicationId !== channels[doc.channel as Channel].applicationId) throw new UpdateError("The manifest's application ID does not belong to its channel.");
  return {
    platform: "android" as const, channel: doc.channel as Channel, applicationId: doc.applicationId as string,
    versionCode: doc.versionCode, versionName: doc.versionName, minSupportedVersionCode: doc.minSupportedVersionCode,
    sha256: String(doc.sha256).toLowerCase(), downloadUrl: doc.downloadUrl as string,
    sizeBytes: isCount(doc.sizeBytes) ? doc.sizeBytes : null,
    publishedAt: typeof doc.publishedAt === "string" ? doc.publishedAt : "", notes: typeof doc.notes === "string" ? doc.notes : "",
  };
}

const cache = new Map<Channel, { url: string; manifest: ReturnType<typeof parseManifest> | null; expiresAt: number }>();
export const resetReleaseCache = () => cache.clear();

// Read from GitHub's direct release-download links, not api.github.com: the API's anonymous limit (60 an hour per IP)
// is shared by everything on Render's outbound IPs and was already spent, so every lookup failed.
const downloadUrl = (channel: Channel, name: string) => `https://github.com/${REPOSITORY}/releases/download/${channels[channel].releaseTag}/${name}`;

async function release(channel: Channel) {
  const config = channels[channel];
  const previous = cache.get(channel);
  if (previous && previous.expiresAt > Date.now()) return previous;
  const url = downloadUrl(channel, config.assetName);
  const head = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "GigWork-download" }, signal: AbortSignal.timeout(10_000) });
  if (!head.ok) throw new Error(`Android ${channel} is not available yet.`);
  const size = Number(head.headers.get("content-length"));
  let manifest: ReturnType<typeof parseManifest> | null = null;
  try {
    const document = await fetch(downloadUrl(channel, config.manifestName), { redirect: "follow", headers: { "User-Agent": "GigWork-download" }, signal: AbortSignal.timeout(10_000) });
    if (document.ok) {
      const parsed = parseManifest({ ...(await document.json()), downloadUrl: url, sizeBytes: Number.isSafeInteger(size) && size > 0 ? size : undefined });
      manifest = parsed.channel === channel ? parsed : null;
    }
  } catch { manifest = null; }
  const result = { url, manifest, expiresAt: Date.now() + CACHE_MS };
  cache.set(channel, result);
  return result;
}

function requestedChannel(request: Request, response: Response): Channel | null {
  const raw = request.query.channel;
  if (raw === undefined) return "preview";
  if (isChannel(raw)) return raw;
  response.status(400).json({ error: { code: "unknown_channel", message: "Unknown Android channel. Use preview or production." } });
  return null;
}

const unavailable = (response: Response, channel: Channel) =>
  response.status(503).json({ error: { code: "android_unavailable", message: `The GigWork Android ${channel} build isn't published yet. Try again shortly.` } });

export const mobileRouter = Router();

mobileRouter.get("/android", async (request, response) => {
  const channel = requestedChannel(request, response);
  if (!channel) return;
  try {
    const latest = await release(channel);
    response.json({ data: { platform: "android", channel, downloadUrl: latest.url, manifest: latest.manifest } });
  } catch { unavailable(response, channel); }
});

// What an installed app asks on launch. No manifest is a 503, not "no update": the app then stays quiet rather than
// claiming it is up to date, and never prompts with nothing to install.
mobileRouter.get("/android/manifest", async (request, response) => {
  const channel = requestedChannel(request, response);
  if (!channel) return;
  try {
    const latest = await release(channel);
    if (!latest.manifest) {
      response.status(503).json({ error: { code: "no_manifest", message: "This release does not publish a version manifest, so no update was offered." } });
      return;
    }
    response.json({ data: { channel, manifest: latest.manifest } });
  } catch { unavailable(response, channel); }
});

// The web app's "Download for Android" button.
mobileRouter.get("/android/download", async (request, response) => {
  const channel = requestedChannel(request, response);
  if (!channel) return;
  try {
    const latest = await release(channel);
    response.setHeader("Cache-Control", "no-store");
    response.redirect(302, latest.url);
  } catch { unavailable(response, channel); }
});
