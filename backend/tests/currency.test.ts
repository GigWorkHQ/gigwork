import { describe, expect, test } from "bun:test";
import { jobAssetSchema, parseUsdgAmount, usdgAmountSchema } from "../src/currency.js";

describe("USDG-only job currency", () => {
  test("accepts USDG and rejects native ETH as a job asset", () => {
    expect(jobAssetSchema.parse("usdg")).toBe("usdg");
    expect(jobAssetSchema.safeParse("eth").success).toBe(false);
  });

  test("accepts plain decimal amounts and respects token precision", () => {
    expect(usdgAmountSchema.safeParse("12.345678").success).toBe(true);
    expect(parseUsdgAmount("12.345678", 6)).toBe(12_345_678n);
    expect(() => parseUsdgAmount("12.3456789", 6)).toThrow("too many decimal places");
  });

  test("rejects zero or negative job amounts", () => {
    expect(() => parseUsdgAmount("0", 6)).toThrow("greater than zero");
    expect(usdgAmountSchema.safeParse("-1").success).toBe(false);
  });
});
