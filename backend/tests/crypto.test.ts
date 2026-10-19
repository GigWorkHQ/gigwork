import { describe, expect, test } from "bun:test";
import {
  decryptPayload,
  decryptSecret,
  encryptPayload,
  encryptSecret,
  payloadDigest,
} from "../src/crypto.js";

describe("encrypted backend data", () => {
  test("round-trips escrow secrets and rejects modified or wrong-context ciphertext", () => {
    const encrypted = encryptSecret("private-key-fixture", "escrow:one");
    expect(encrypted).not.toContain("private-key-fixture");
    expect(decryptSecret(encrypted, "escrow:one")).toBe("private-key-fixture");
    expect(() => decryptSecret(encrypted, "escrow:two")).toThrow();
    expect(() => decryptSecret(`${encrypted.slice(0, -2)}xx`, "escrow:one")).toThrow();
  });

  test("keeps submission payload encryption context-specific", () => {
    const encrypted = encryptPayload("deliverable", "job:revision");
    expect(decryptPayload(encrypted, "job:revision")).toBe("deliverable");
    expect(() => decryptPayload(encrypted, "job:other-revision")).toThrow();
  });

  test("creates stable keyed payload digests", () => {
    const digest = payloadDigest("same payload");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadDigest("same payload")).toBe(digest);
    expect(payloadDigest("different payload")).not.toBe(digest);
  });
});
