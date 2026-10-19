import { describe, expect, test } from "bun:test";
import { decodeFunctionData, erc20Abi, type Address } from "viem";
import { escrowGasReserve, escrowSweepAmount, usdgPayoutTransaction } from "../src/settlement.js";

const recipient = `0x${"11".repeat(20)}` as Address;
const token = `0x${"22".repeat(20)}` as Address;

describe("USDG settlement transactions", () => {
  test("pays the exact USDG amount through the configured token contract", () => {
    const transaction = usdgPayoutTransaction(recipient, token, "9876543", 7n);
    const transfer = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
    expect(transaction).toMatchObject({ to: token, value: 0n, gas: 100_000n, gasPrice: 7n });
    expect(transfer).toEqual({ functionName: "transfer", args: [recipient, 9_876_543n] });
  });

  test("reserves escrow gas and sweeps only the balance above the transaction fee", () => {
    expect(escrowGasReserve(2n)).toBe(604_000n);
    expect(escrowSweepAmount(1_000_000n, 2n)).toBe(958_000n);
    expect(escrowSweepAmount(10n, 2n)).toBe(-41_990n);
  });
});
