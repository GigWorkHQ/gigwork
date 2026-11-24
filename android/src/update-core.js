// What "there is an update" means, decided in one place (ported from Tera's core/update.js).
//
// Nothing here fetches or installs. It is given a manifest and this build's version and returns a decision, so the
// phone and the release script (scripts/release-manifest.mjs) apply exactly the same checks. The rule that matters
// most: a manifest naming a version older than the installed one is never offered, so nobody is moved backwards.

export class UpdateError extends Error {}
export const CURRENT = "current";
export const OPTIONAL = "optional";
export const REQUIRED = "required";

// Each channel is its own Android app: an APK installs over an existing app only when application ID and signing key
// both match, so one channel's file must never be offered to the other.
export const CHANNELS = {
  preview: { applicationId: "com.gigworkhq.android.preview" },
  production: { applicationId: "com.gigworkhq.android" },
};

export function channelForApplicationId(applicationId) {
  for (const [channel, config] of Object.entries(CHANNELS)) if (config.applicationId === applicationId) return channel;
  return null;
}

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isSha256 = (value) => typeof value === "string" && /^[\da-f]{64}$/i.test(value);

export function parseManifest(doc) {
  if (!doc || typeof doc !== "object") throw new UpdateError("This is not a readable manifest.");
  if (doc.platform !== "android") throw new UpdateError("This manifest is not for Android.");
  if (!isCount(doc.versionCode)) throw new UpdateError("The manifest has no version code.");
  if (!isCount(doc.minSupportedVersionCode)) throw new UpdateError("The manifest has no supported floor.");
  if (doc.minSupportedVersionCode > doc.versionCode) throw new UpdateError("The manifest requires a version newer than the one it publishes.");
  if (typeof doc.versionName !== "string" || !doc.versionName) throw new UpdateError("The manifest has no version name.");
  // Without a digest the download has nothing to be checked against, which would make the update button a remote
  // install channel guarded only by TLS.
  if (!isSha256(doc.sha256)) throw new UpdateError("The manifest does not say what the download should hash to.");
  if (typeof doc.downloadUrl !== "string" || !/^https:\/\//.test(doc.downloadUrl)) throw new UpdateError("The manifest has no https download.");
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, doc.channel)) throw new UpdateError("The manifest names a channel this app does not know.");
  if (doc.applicationId !== CHANNELS[doc.channel].applicationId) throw new UpdateError("The manifest's application ID does not belong to its channel.");
  return {
    platform: "android", channel: doc.channel, applicationId: doc.applicationId,
    versionCode: doc.versionCode, versionName: doc.versionName, minSupportedVersionCode: doc.minSupportedVersionCode,
    sha256: String(doc.sha256).toLowerCase(), downloadUrl: doc.downloadUrl,
    sizeBytes: isCount(doc.sizeBytes) ? doc.sizeBytes : null,
    publishedAt: typeof doc.publishedAt === "string" ? doc.publishedAt : "", notes: typeof doc.notes === "string" ? doc.notes : "",
  };
}

export function updateState({ manifest, installed, channel }) {
  const published = parseManifest(manifest);
  if (published.channel !== channel) throw new UpdateError(`This manifest is for ${published.channel}, not ${channel}.`);
  // A build that can't read its own version is offered nothing rather than treated as ancient.
  if (!isCount(installed)) return { state: CURRENT, manifest: published, reason: "This build does not report its version." };
  if (installed >= published.versionCode)
    return { state: CURRENT, manifest: published, reason: installed > published.versionCode ? "This build is newer than the published one." : "This is the published build." };
  if (installed < published.minSupportedVersionCode)
    return { state: REQUIRED, manifest: published, reason: `Builds below ${published.minSupportedVersionCode} are no longer supported.` };
  return { state: OPTIONAL, manifest: published, reason: `Version ${published.versionName} is available.` };
}

// "We couldn't hash it" must never read as "it matched".
export function verifyDownload({ manifest, digest }) {
  const published = parseManifest(manifest);
  if (!isSha256(digest)) throw new UpdateError("The download could not be checked, so it was not installed.");
  if (String(digest).toLowerCase() !== published.sha256) throw new UpdateError("The download doesn't match the published build and was not installed.");
  return true;
}
