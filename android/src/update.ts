// Updating the app from inside the app (Tera's flow). On launch the app asks the GigWork API what the published build
// for its channel is. If it is newer, Home shows a bubble; Update downloads the APK here, hashes it, compares the digest
// with the one the build workflow published, and only then hands it to Android's installer, which shows its own
// confirmation screen. A mismatch deletes the file and installs nothing.
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { API } from "./config";
import { CURRENT, OPTIONAL, REQUIRED, channelForApplicationId, updateState, verifyDownload } from "./update-core.js";

export { CURRENT, OPTIONAL, REQUIRED };
export type Manifest = { channel: string; applicationId: string; versionCode: number; versionName: string; minSupportedVersionCode: number; sha256: string; downloadUrl: string; sizeBytes: number | null; notes: string };
export type UpdateDecision = { state: string; manifest: Manifest; reason: string };

const CHUNK_BYTES = 512 * 1024;

export function installedVersionCode(): number | null {
  const raw = Number(Application.nativeBuildVersion);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}
export const installedVersionName = () => Application.nativeApplicationVersion ?? "";
export const installedChannel = (): string | null => channelForApplicationId(Application.applicationId);

/** Silence, not "up to date", when the check can't be made. */
export async function checkForUpdate(): Promise<UpdateDecision | null> {
  const channel = installedChannel();
  if (!channel || !API.startsWith("https://")) return null;
  try {
    const response = await fetch(`${API}/v1/mobile/android/manifest?channel=${channel}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.data?.manifest) return null;
    return updateState({ manifest: body.data.manifest, installed: installedVersionCode(), channel }) as UpdateDecision;
  } catch {
    return null;
  }
}

export async function downloadApk(manifest: Manifest, onProgress?: (fraction: number) => void): Promise<string> {
  if (manifest.applicationId !== Application.applicationId) throw new Error("This download is for a different app.");
  const target = `${FileSystem.cacheDirectory}gigwork-${manifest.versionCode}.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  const download = FileSystem.createDownloadResumable(manifest.downloadUrl, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    if (onProgress && totalBytesExpectedToWrite > 0) onProgress(totalBytesWritten / totalBytesExpectedToWrite);
  });
  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error("The download didn't finish.");
  try {
    verifyDownload({ manifest, digest: await digestOf(result.uri) });
  } catch (error) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw error;
  }
  return result.uri;
}

async function digestOf(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !("size" in info) || !info.size) throw new Error("The download couldn't be read.");
  const hash = sha256.create();
  for (let position = 0; position < info.size; position += CHUNK_BYTES) {
    const slice = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position, length: Math.min(CHUNK_BYTES, info.size - position) });
    hash.update(base64Bytes(slice));
  }
  return bytesToHex(hash.digest());
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let written = 0, buffer = 0, bits = 0;
  for (let index = 0; index < clean.length; index += 1) {
    buffer = (buffer << 6) | BASE64.indexOf(clean[index]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[written++] = (buffer >> bits) & 0xff; }
  }
  return out.subarray(0, written);
}

/** Android shows its own install screen next, and asks once to allow installs from GigWork. Neither can be skipped. */
export async function installApk(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: contentUri, flags: 1, type: "application/vnd.android.package-archive",
  });
}
