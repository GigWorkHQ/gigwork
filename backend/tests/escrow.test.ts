import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address } from "viem";
import {
  loadEscrowAccount,
  makeEscrowWallet,
  parseHash,
  validateUsdgFunding,
  type FundingTerms,
} from "../src/escrow.js";
import { config } from "../src/config.js";

const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
const client = `0x${"11".repeat(20)}` as Address;
const worker = `0x${"22".repeat(20)}` as Address;
const token = `0x${"33".repeat(20)}` as Address;
const terms: FundingTerms = {
  id: "job-1",
  client_wallet: client,
  asset: "usdg",
  amount_raw: "2500000",
  token_address: token,
};

function makeProof(overrides: Record<string, unknown> = {}) {
  const topics = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from: client, to: worker },
  });
  const log = {
    address: token,
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [2_500_000n]),
    blockHash: `0x${"44".repeat(32)}`,
    blockNumber: 100n,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
  return {
    transaction: { chainId: config.RH_CHAIN_ID, from: client, to: token, value: 0n, input: "0x" },
    receipt: { status: "success", blockNumber: 100n, logs: [log] },
    latestBlock: 200n,
    ...overrides,
  } as never;
}

function errorCode(action: () => unknown) {
  try { action(); } catch (error) { return (error as { code?: string }).code; }
  throw new Error("Expected funding verification to fail.");
}

describe("job escrow", () => {
  test("validates transaction hashes and creates context-bound escrow wallets", () => {
    expect(parseHash(hash)).toBe(hash);
    expect(() => parseHash("0x1234")).toThrow("valid transaction hash");
    const wallet = makeEscrowWallet("job-1");
    expect(wallet.encryptedPrivateKey).not.toContain(wallet.address);
    expect(loadEscrowAccount("job-1", wallet.encryptedPrivateKey).address.toLowerCase()).toBe(wallet.address);
    expect(() => loadEscrowAccount("job-2", wallet.encryptedPrivateKey)).toThrow();
  });

  test("accepts only exact, confirmed USDG transfers from the client to escrow", () => {
    expect(validateUsdgFunding(terms, worker, parseHash(hash), makeProof())).toEqual({ hash, blockNumber: "100" });
    const invalidProofs: Array<[Record<string, unknown>, string]> = [
      [{ transaction: { chainId: 1, from: client, to: token, value: 0n, input: "0x" } }, "wrong_chain"],
      [{ transaction: { chainId: config.RH_CHAIN_ID, from: worker, to: token, value: 0n, input: "0x" } }, "funding_wallet_mismatch"],
      [{ transaction: { chainId: config.RH_CHAIN_ID, from: client, to: worker, value: 0n, input: "0x" } }, "funding_asset_mismatch"],
      [{ transaction: { chainId: config.RH_CHAIN_ID, from: client, to: token, value: 1n, input: "0x" } }, "funding_asset_mismatch"],
      [{ latestBlock: 100n }, "funding_confirmations_pending"],
      [{ receipt: { status: "reverted", blockNumber: 100n, logs: [] } }, "funding_failed"],
    ];
    for (const [overrides, code] of invalidProofs)
      expect(errorCode(() => validateUsdgFunding(terms, worker, parseHash(hash), makeProof(overrides)))).toBe(code);
    const wrongAmount = { ...terms, amount_raw: "1" };
    expect(errorCode(() => validateUsdgFunding(wrongAmount, worker, parseHash(hash), makeProof()))).toBe("funding_amount_mismatch");
  });
});
