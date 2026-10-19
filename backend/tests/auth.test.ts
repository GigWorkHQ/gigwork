import { describe, expect, test } from "bun:test";
import { extractBearerToken, hashSessionToken, isTeamWallet, signInMessage } from "../src/auth.js";

describe("team wallet authorization", () => {
  test("matches wallet addresses case-insensitively and rejects non-members", () => {
    const authorized = new Set(["0xabc123"]);
    expect(isTeamWallet("0xABC123", authorized)).toBe(true);
    expect(isTeamWallet("0xdef456", authorized)).toBe(false);
  });

  test("builds a scoped SIWE challenge and hashes session tokens", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const message = signInMessage(`0x${"ab".repeat(20)}`, "nonce123", issuedAt, new Date("2026-01-01T00:10:00.000Z"));
    expect(message).toContain("Sign in to GigWork.");
    expect(message).toContain("nonce123");
    expect(hashSessionToken("session-token")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken("session-token")).toBe(hashSessionToken("session-token"));
    expect(hashSessionToken("other-token")).not.toBe(hashSessionToken("session-token"));
  });

  test("accepts bearer headers without accepting malformed authorization", () => {
    expect(extractBearerToken("Bearer session-token")).toBe("session-token");
    expect(extractBearerToken("bearer  token-with-space")).toBe("token-with-space");
    expect(extractBearerToken("Basic credentials")).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
  });
});
