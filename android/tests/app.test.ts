import { describe, expect, test } from "bun:test";
import { buildNeeds } from "../src/needs";
import { money, relative, sumAmounts } from "../src/format";
import { CURRENT, OPTIONAL, REQUIRED, parseManifest, updateState, verifyDownload } from "../src/update-core.js";

const me = "0xaaaa000000000000000000000000000000000001";
const other = "0xbbbb000000000000000000000000000000000002";
const job = (over: Record<string, unknown>) => ({ id: "j1", title: "Logo", amount: "5", clientWallet: other, doerWallet: me, status: "in_progress", ...over });

describe("needs you", () => {
  test("work to submit, review and answer is listed, most urgent first", () => {
    const needs = buildNeeds({
      wallet: me,
      jobs: [job({}), job({ id: "j2", clientWallet: me, doerWallet: other, status: "submitted" })],
      assignments: [{ id: "a1", status: "claimed", title: "Judge", pay: "0.2" }],
    });
    expect(needs.map((n) => n.action)).toEqual(["Answer", "Review", "Submit"]);
  });
  test("funding is listed but opens the exact item on the web", () => {
    const [need] = buildNeeds({ wallet: me, jobs: [job({ clientWallet: me, doerWallet: null, status: "awaiting_funding" })] });
    expect(need.action).toBe("Fund on web");
    expect(need.web).toBe("/app/jobs?as=client&open=j1");
  });
  test("other people's jobs and finished work are not listed", () => {
    expect(buildNeeds({ wallet: me, jobs: [job({ doerWallet: other }), job({ status: "completed" })] })).toEqual([]);
  });
  test("gig milestones and contract offers reach the right side", () => {
    const gig = { id: "g1", title: "Site", role: "worker", status: "active", total: "2", milestones: [{ id: "m1", title: "Copy", status: "funded", amount: "1" }, { id: "m2", title: "Edit", status: "revision_requested", amount: "1" }] };
    expect(buildNeeds({ wallet: me, gigs: [gig] }).map((n) => n.action)).toEqual(["Submit", "Start"]);
    expect(buildNeeds({ wallet: me, gigs: [{ ...gig, role: "client" }] })).toEqual([]);
    const offer = { id: "c1", title: "Weekly", role: "worker", status: "offered", rate: "0.5", periodDays: 7 };
    expect(buildNeeds({ wallet: me, contracts: [offer] })[0].action).toBe("Respond");
  });
});

const manifest = {
  platform: "android", channel: "preview", applicationId: "com.gigworkhq.android.preview", versionCode: 10, versionName: "1.0.0",
  minSupportedVersionCode: 4, sha256: "ab".repeat(32), downloadUrl: "https://github.com/gigworkhq/gigwork/releases/download/android-preview/x.apk",
};

describe("updates", () => {
  test("never offers a downgrade; requires an update below the floor", () => {
    expect(updateState({ manifest, installed: 10, channel: "preview" }).state).toBe(CURRENT);
    expect(updateState({ manifest, installed: 12, channel: "preview" }).state).toBe(CURRENT);
    expect(updateState({ manifest, installed: 7, channel: "preview" }).state).toBe(OPTIONAL);
    expect(updateState({ manifest, installed: 3, channel: "preview" }).state).toBe(REQUIRED);
    expect(updateState({ manifest, installed: null, channel: "preview" }).state).toBe(CURRENT);
  });
  test("refuses the other channel's app, a missing digest, and a plain-http download", () => {
    expect(() => updateState({ manifest, installed: 1, channel: "production" })).toThrow();
    expect(() => parseManifest({ ...manifest, applicationId: "com.gigworkhq.android" })).toThrow();
    expect(() => parseManifest({ ...manifest, sha256: "" })).toThrow();
    expect(() => parseManifest({ ...manifest, downloadUrl: "http://x/y.apk" })).toThrow();
  });
  test("a download installs only when its digest matches", () => {
    expect(verifyDownload({ manifest, digest: "AB".repeat(32) })).toBe(true);
    expect(() => verifyDownload({ manifest, digest: "cd".repeat(32) })).toThrow();
    expect(() => verifyDownload({ manifest, digest: null })).toThrow();
  });
});

describe("format", () => {
  test("sums USDG without floating point", () => {
    expect(sumAmounts(["0.1", "0.2"])).toBe("0.3");
    expect(sumAmounts(["1.000001", "2", null])).toBe("3.000001");
  });
  test("money shows two decimals", () => {
    expect(money("1234.5")).toBe("1,234.50");
    expect(money(undefined)).toBe("0.00");
  });
  test("relative times read naturally", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(relative("2026-11-24T15:00:00Z", now)).toBe("in 3h");
    expect(relative("2026-11-22T12:00:00Z", now)).toBe("2d ago");
  });
});
