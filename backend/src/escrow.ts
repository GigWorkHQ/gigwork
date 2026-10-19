import {
  createPublicClient,
  defineChain,
  erc20Abi,
  http,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { ApiError } from "./http.js";

export const chain = defineChain({
  id: config.RH_CHAIN_ID,
  name: config.RH_CHAIN_ID === 4663 ? "Robinhood Chain" : "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.RH_RPC_URL] } },
  blockExplorers: {
    default: {
      name: config.RH_CHAIN_ID === 4663 ? "Robinhood Chain Explorer" : "Robinhood Testnet Explorer",
      url:
        config.RH_CHAIN_ID === 4663
          ? "https://robinhoodchain.blockscout.com"
          : "https://explorer.testnet.chain.robinhood.com",
    },
  },
});

export const publicClient = createPublicClient({ chain, transport: http(config.RH_RPC_URL) });
export const gasAccount = privateKeyToAccount(config.GAS_WALLET_PRIVATE_KEY as `0x${string}`);
export const gasWalletAddress = gasAccount.address.toLowerCase() as Address;

export type JobAsset = "usdg";
export type FundingTerms = {
  id: string;
  client_wallet: string;
  asset: JobAsset;
  amount_raw: string;
  token_address: string;
};

type FundingProof = {
  transaction: { chainId?: number | null; from: string; to?: string | null; value: bigint; input: string };
  receipt: { status: string; blockNumber: bigint; logs: readonly unknown[] };
  latestBlock: bigint;
};

export function makeEscrowWallet(jobId: string) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address.toLowerCase(),
    encryptedPrivateKey: encryptSecret(privateKey, `job-escrow:${jobId}`),
  };
}

export function loadEscrowAccount(jobId: string, encryptedPrivateKey: string) {
  return privateKeyToAccount(
    decryptSecret(encryptedPrivateKey, `job-escrow:${jobId}`) as `0x${string}`,
  );
}

export function parseHash(value: string): Hash {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new ApiError(400, "invalid_transaction_hash", "A valid transaction hash is required.");
  return value.toLowerCase() as Hash;
}

export function validateUsdgFunding(
  terms: FundingTerms,
  escrowAddress: string,
  hash: Hash,
  proof: FundingProof,
) {
  const { receipt, transaction, latestBlock } = proof;
  if (receipt.status !== "success") throw new ApiError(422, "funding_failed", "The funding transaction reverted.");
  if (transaction.chainId !== config.RH_CHAIN_ID)
    throw new ApiError(422, "wrong_chain", "The transaction was not sent on the configured Robinhood Chain network.");
  if (transaction.from.toLowerCase() !== terms.client_wallet.toLowerCase())
    throw new ApiError(422, "funding_wallet_mismatch", "The job client must fund escrow from their signed-in wallet.");

  const requiredBlock = receipt.blockNumber + BigInt(config.RH_CONFIRMATIONS - 1);
  if (latestBlock < requiredBlock)
    throw new ApiError(409, "funding_confirmations_pending", "The funding transaction needs more confirmations.");

  const escrow = escrowAddress.toLowerCase();
  const token = terms.token_address;
  if (transaction.to?.toLowerCase() !== token.toLowerCase() || transaction.value !== 0n)
    throw new ApiError(422, "funding_asset_mismatch", "Fund this job with its configured USDG token contract.");
  const tokenLogs = receipt.logs.filter((log) => {
    if (!log || typeof log !== "object" || !("address" in log)) return false;
    return typeof log.address === "string" && log.address.toLowerCase() === token.toLowerCase();
  });
  const matching = parseEventLogs({
    abi: erc20Abi,
    logs: tokenLogs as never,
    eventName: "Transfer",
    strict: false,
  }).filter(
    (event) =>
      event.args.from?.toLowerCase() === terms.client_wallet.toLowerCase() &&
      event.args.to?.toLowerCase() === escrow &&
      event.args.value === BigInt(terms.amount_raw),
  );
  if (matching.length !== 1)
    throw new ApiError(422, "funding_amount_mismatch", "Send exactly the listed USDG amount from your wallet to this job escrow address.");
  return { hash, blockNumber: receipt.blockNumber.toString() };
}

export async function verifyJobFunding(
  terms: FundingTerms,
  escrowAddress: string,
  fundingHash: string,
) {
  const hash = parseHash(fundingHash);
  let receipt;
  let transaction;
  try {
    [receipt, transaction] = await Promise.all([
      publicClient.getTransactionReceipt({ hash }),
      publicClient.getTransaction({ hash }),
    ]);
  } catch {
    throw new ApiError(409, "funding_not_confirmed", "The funding transaction is not available yet.");
  }
  const latestBlock = await publicClient.getBlockNumber();
  return validateUsdgFunding(terms, escrowAddress, hash, { transaction, receipt, latestBlock });
}
