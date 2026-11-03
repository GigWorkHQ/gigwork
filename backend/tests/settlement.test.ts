import { describe, expect, test } from "bun:test";
import { decodeFunctionData, erc20Abi, type Address } from "viem";
import { ETH_TRANSFER_GAS, escrowGasReserve, escrowSweepAmount, firstFreeNonce, isStaleRejection, usdgPayoutTransaction } from "../src/settlement.js";

const recipient = `0x${"11".repeat(20)}` as Address;
const token = `0x${"22".repeat(20)}` as Address;

describe("USDG settlement transactions", () => {
  test("pays the exact USDG amount through the configured token contract", () => {
    const transaction = usdgPayoutTransaction(recipient, token, "9876543", 7n);
    const transfer = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
    expect(transaction).toMatchObject({ to: token, value: 0n, gas: 150_000n, gasPrice: 7n });
    expect(transfer).toEqual({ functionName: "transfer", args: [recipient, 9_876_543n] });
  });

  test("gives ETH transfers room for the Arbitrum L1 data fee", () => {
    // A plain ETH transfer on Robinhood Chain mainnet estimates at about 21,510 gas.
    expect(ETH_TRANSFER_GAS > 21_510n).toBe(true);
  });

  test("reserves escrow gas and sweeps only the balance above the transaction fee", () => {
    expect(escrowGasReserve(2n)).toBe(800_000n);
    expect(escrowSweepAmount(1_000_000n, 2n)).toBe(900_000n);
    expect(escrowSweepAmount(10n, 2n)).toBe(-99_990n);
  });
});

describe("stale signed transactions", () => {
  test("recognises rejections that a fresh signature fixes", () => {
    expect(isStaleRejection("intrinsic gas too low: have 21000, want 21510")).toBe(true);
    expect(isStaleRejection("max fee per gas less than block base fee")).toBe(true);
    expect(isStaleRejection("transaction underpriced")).toBe(true);
    expect(isStaleRejection("nonce too high")).toBe(true);
  });

  test("leaves other failures to plain retries", () => {
    expect(isStaleRejection("replacement transaction underpriced")).toBe(false);
    expect(isStaleRejection("insufficient funds for gas * price + value")).toBe(false);
    expect(isStaleRejection("fetch failed")).toBe(false);
  });

  test("takes the lowest free gas-wallet nonce so cleared transactions leave no gap", () => {
    expect(firstFreeNonce(5, [])).toBe(5);
    expect(firstFreeNonce(5, [5, 6, 8])).toBe(7);
    expect(firstFreeNonce(5, [6, 7])).toBe(5);
  });
});
