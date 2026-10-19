import { parseUnits } from "viem";
import { z } from "zod";
import { ApiError } from "./http.js";

export const jobAssetSchema = z.literal("usdg");
export const usdgAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,18})?$/, "Enter a plain decimal USDG amount.");

export function parseUsdgAmount(value: string, decimals: number) {
  const fraction = value.split(".")[1] ?? "";
  if (fraction.length > decimals)
    throw new ApiError(400, "invalid_amount", "The USDG amount has too many decimal places.");
  let amount: bigint;
  try {
    amount = parseUnits(value, decimals);
  } catch {
    throw new ApiError(400, "invalid_amount", "The USDG amount has too many decimal places.");
  }
  if (amount <= 0n) throw new ApiError(400, "invalid_amount", "The job amount must be greater than zero.");
  return amount;
}
