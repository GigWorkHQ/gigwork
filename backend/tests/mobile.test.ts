import { describe, expect, test } from "bun:test";
import { parseManifest } from "../src/mobile.js";
import { normalizePairingCode, newPairingCode } from "../src/pairing.js";

const good = {
  platform: "android", channel: "preview", applicationId: "com.gigworkhq.android.preview", versionCode: 7, versionName: "1.0.0",
  minSupportedVersionCode: 1, sha256: "a".repeat(64), downloadUrl: "https://github.com/gigworkhq/gigwork/releases/download/android-preview/x.apk",
};

describe("android release manifest", () => {
  test("accepts a complete manifest", () => expect(parseManifest(good).versionCode).toBe(7));
  test("refuses a manifest without a digest, for another app, or with a floor above its version", () => {
    expect(() => parseManifest({ ...good, sha256: undefined })).toThrow();
    expect(() => parseManifest({ ...good, applicationId: "com.gigworkhq.android" })).toThrow();
    expect(() => parseManifest({ ...good, minSupportedVersionCode: 8 })).toThrow();
    expect(() => parseManifest({ ...good, downloadUrl: "http://example.com/x.apk" })).toThrow();
  });
});

describe("pairing codes", () => {
  test("codes are 8 unambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(newPairingCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
  });
  test("spelling variations normalize; ambiguous or short input is not a code", () => {
    expect(normalizePairingCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizePairingCode(" ABCD 2345 ")).toBe("ABCD2345");
    expect(normalizePairingCode("ABCD-0000")).toBeNull();
    expect(normalizePairingCode("ABC")).toBeNull();
  });
});
