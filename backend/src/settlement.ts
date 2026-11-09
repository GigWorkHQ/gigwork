import { TransactionNotFoundError, TransactionReceiptNotFoundError, encodeFunctionData, erc20Abi, keccak256, type Address, type Hash, type Hex } from "viem";
import { db } from "./db/index.js";
import { config } from "./config.js";
import { gasAccount, gasWalletAddress, loadEscrowAccount, publicClient } from "./escrow.js";

type Settlement = {
  id: string; job_id: string; outcome: "pay_doer" | "refund_client"; recipient: Address;
  amount_raw: string; status: string; phase: string; gas_nonce: string | null;
  gas_signed_tx: Hex | null; gas_tx_hash: Hash | null; payout_nonce: string | null;
  payout_signed_tx: Hex | null; payout_tx_hash: Hash | null; sweep_nonce: string | null;
  sweep_signed_tx: Hex | null; sweep_tx_hash: Hash | null; asset: "usdg";
  token_address: Address; escrow_address: Address; encrypted_private_key: string;
};

// Robinhood Chain is an Arbitrum chain: gas used includes the L1 data fee, so a plain ETH transfer costs
// more than 21,000 gas (about 21,500 today). Limits leave room for L1 fee spikes; unused gas is not charged.
export const ETH_TRANSFER_GAS = 50_000n;
export const USDG_TRANSFER_GAS = 150_000n;

export function usdgPayoutTransaction(recipient: Address, tokenAddress: Address, amountRaw: string, gasPrice: bigint) {
  return {
    to: tokenAddress,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, BigInt(amountRaw)] }),
    gas: USDG_TRANSFER_GAS,
    gasPrice,
  };
}

// Twice the quoted price, so a small base-fee rise between signing and inclusion doesn't reject the transaction.
export async function payableGasPrice() {
  return (await publicClient.getGasPrice()) * 2n;
}

export function escrowGasReserve(gasPrice: bigint) {
  return gasPrice * (USDG_TRANSFER_GAS + ETH_TRANSFER_GAS) * 2n;
}

export function escrowSweepAmount(balance: bigint, gasPrice: bigint) {
  return balance - gasPrice * ETH_TRANSFER_GAS;
}

export class RevertedError extends Error {}
// A signed transaction that can never be mined (rejected for its gas or fee, nonce taken, or dropped): the caller
// clears it so the next attempt signs a fresh one.
export class StaleTxError extends Error {}

const STALE_REJECTION = /intrinsic gas too low|gas limit too low|base fee|fee too low|transaction underpriced|nonce too high/;
export function isStaleRejection(message: string) {
  const text = message.toLowerCase();
  return STALE_REJECTION.test(text) && !text.includes("replacement");
}

// Shared with escrow transfers so the gas wallet never signs two transactions with one nonce.
export const GAS_WALLET_LOCK = 73301822;
// The lowest nonce at or above the chain's pending count that no signed, unconfirmed transaction holds. Taking the
// lowest free one (not the highest used plus one) fills the gap a cleared stale transaction leaves behind.
// Callers hold GAS_WALLET_LOCK.
export async function nextGasNonce(client: { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> }) {
  const pending = await publicClient.getTransactionCount({ address: gasWalletAddress, blockTag: "pending" });
  const result = await client.query(
    `SELECT gas_nonce::text AS nonce FROM job_settlements WHERE gas_nonce>=$1
     UNION SELECT nonce::text FROM gas_topups WHERE nonce>=$1`, [pending]);
  return firstFreeNonce(pending, result.rows.map((row) => Number(row.nonce)));
}

export function firstFreeNonce(start: number, taken: number[]) {
  const used = new Set(taken);
  let nonce = start;
  while (used.has(nonce)) nonce++;
  return nonce;
}

const waitFor = async (hash: Hash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.RH_CONFIRMATIONS });
  if (receipt.status !== "success") throw new RevertedError(`Transaction ${hash} reverted.`);
  return receipt;
};

// Only a definite "not found" from the node means a transaction is absent. Any other lookup failure (timeout, 5xx,
// rate limit) is rethrown, so a restart mid-send never mistakes a mined payout for a dropped one and signs it again
// at a new nonce (audit L-4).
const isNotFound = (error: unknown, kind: typeof TransactionReceiptNotFoundError | typeof TransactionNotFoundError) =>
  error instanceof kind || (error instanceof Error && error.name === kind.name);

export async function receiptOrNull(hash: Hash) {
  try { return await publicClient.getTransactionReceipt({ hash }); }
  catch (error) { if (isNotFound(error, TransactionReceiptNotFoundError)) return null; throw error; }
}

export async function transactionOrNull(hash: Hash) {
  try { return await publicClient.getTransaction({ hash }); }
  catch (error) { if (isNotFound(error, TransactionNotFoundError)) return null; throw error; }
}

export async function sendPersisted(raw: Hex, hash: Hash) {
  try { await publicClient.sendRawTransaction({ serializedTransaction: raw }); }
  catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes("nonce too low")) {
      // Either this transaction was already mined, or another one took its nonce. Only a definite absence of both its
      // receipt and the transaction itself proves the second.
      const receipt = await receiptOrNull(hash);
      if (!receipt && !(await transactionOrNull(hash)))
        throw new StaleTxError(`Transaction ${hash} can't be mined: another transaction used its nonce.`);
    } else if (isStaleRejection(message)) {
      throw new StaleTxError(`Transaction ${hash} was rejected: ${String(error).slice(0, 300)}`);
    } else if (!message.includes("already known") && !message.includes("known transaction")) throw error;
  }
  try { return await waitFor(hash); }
  catch (error) {
    if (error instanceof RevertedError) throw error;
    const known = await transactionOrNull(hash);
    if (!known) throw new StaleTxError(`Transaction ${hash} was dropped before it was mined.`);
    throw error;
  }
}

async function load(jobId: string) {
  const result = await db.query<Settlement>(
    `SELECT s.*,j.asset,j.token_address,ew.address AS escrow_address,ew.encrypted_private_key
     FROM job_settlements s JOIN jobs j ON j.id=s.job_id JOIN job_escrow_wallets ew ON ew.job_id=j.id
     WHERE s.job_id=$1`, [jobId]);
  return result.rows[0];
}

async function signAndPersist(jobId: string, stage: "gas" | "payout" | "sweep", tx: Record<string, unknown>, account: any) {
  const nonceColumn = `${stage}_nonce`;
  const signedColumn = `${stage}_signed_tx`;
  const hashColumn = `${stage}_tx_hash`;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [GAS_WALLET_LOCK]);
    const current = await client.query<any>(`SELECT ${nonceColumn},${signedColumn},${hashColumn} FROM job_settlements WHERE job_id=$1 FOR UPDATE`, [jobId]);
    if (current.rows[0][signedColumn]) {
      await client.query("COMMIT");
      return { raw: current.rows[0][signedColumn] as Hex, hash: current.rows[0][hashColumn] as Hash };
    }
    const nonce = stage === "gas"
      ? await nextGasNonce(client)
      : Math.max(
          await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
          Number((await client.query<{ next_nonce: string }>(
            `SELECT (GREATEST(COALESCE(payout_nonce,-1),COALESCE(sweep_nonce,-1))+1)::text AS next_nonce FROM job_settlements WHERE job_id=$1`, [jobId])).rows[0].next_nonce));
    const raw = await account.signTransaction({ ...tx, nonce, chainId: config.RH_CHAIN_ID, type: "legacy" });
    const hash = keccak256(raw);
    await client.query(`UPDATE job_settlements SET ${nonceColumn}=$2,${signedColumn}=$3,${hashColumn}=$4,updated_at=now() WHERE job_id=$1`,
      [jobId, nonce, raw, hash]);
    await client.query("COMMIT");
    return { raw: raw as Hex, hash };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function ensureStageTx(settlement: Settlement, stage: "gas" | "payout" | "sweep", tx: Record<string, unknown>, account: any) {
  const existingRaw = settlement[`${stage}_signed_tx`];
  if (existingRaw) return { raw: existingRaw, hash: settlement[`${stage}_tx_hash`]! };
  return signAndPersist(settlement.job_id, stage, tx, account);
}

async function sendStage(jobId: string, stage: "gas" | "payout" | "sweep", tx: { raw: Hex; hash: Hash }) {
  try { return await sendPersisted(tx.raw, tx.hash); }
  catch (error) {
    if (error instanceof StaleTxError)
      await db.query(`UPDATE job_settlements SET ${stage}_nonce=NULL,${stage}_signed_tx=NULL,${stage}_tx_hash=NULL,updated_at=now() WHERE job_id=$1 AND ${stage}_tx_hash=$2`, [jobId, tx.hash]);
    throw error;
  }
}

export async function processSettlement(jobId: string) {
  const lease = await db.query(
    `UPDATE job_settlements SET lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
     WHERE job_id=$1 AND status='pending' AND (lease_until IS NULL OR lease_until<now()) RETURNING id`, [jobId]);
  if (!lease.rowCount) return;
  try {
    let settlement = await load(jobId);
    if (!settlement) throw new Error("Settlement record is missing.");
    const escrow = loadEscrowAccount(jobId, settlement.encrypted_private_key);
    const gasPrice = await payableGasPrice();

    {
      const reserve = escrowGasReserve(gasPrice);
      const gasTx = await ensureStageTx(settlement, "gas", {
        to: settlement.escrow_address, value: reserve, gas: ETH_TRANSFER_GAS, gasPrice,
      }, gasAccount);
      await sendStage(jobId, "gas", gasTx);
      await db.query("UPDATE job_settlements SET phase='payout',updated_at=now() WHERE job_id=$1", [jobId]);
    }

    settlement = await load(jobId);
    {
      const payout = await ensureStageTx(
        settlement,
        "payout",
        usdgPayoutTransaction(settlement.recipient, settlement.token_address, settlement.amount_raw, gasPrice),
        escrow,
      );
      await sendStage(jobId, "payout", payout);
      await db.query("UPDATE job_settlements SET phase='sweep',updated_at=now() WHERE job_id=$1", [jobId]);
    }

    settlement = await load(jobId);
    if (settlement.sweep_signed_tx && settlement.sweep_tx_hash) {
      await sendStage(jobId, "sweep", { raw: settlement.sweep_signed_tx, hash: settlement.sweep_tx_hash });
    } else {
      const balance = await publicClient.getBalance({ address: settlement.escrow_address });
      const sweepValue = escrowSweepAmount(balance, gasPrice);
      if (sweepValue > 0n) {
        const sweep = await ensureStageTx(settlement, "sweep", {
          to: gasWalletAddress, value: sweepValue, gas: ETH_TRANSFER_GAS, gasPrice,
        }, escrow);
        await sendStage(jobId, "sweep", sweep);
      }
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE job_settlements SET status='complete',phase='complete',lease_until=NULL,error=NULL,updated_at=now() WHERE job_id=$1", [jobId]);
      await client.query("UPDATE jobs SET status=$2,settled_at=now(),updated_at=now() WHERE id=$1 AND status='settlement_pending'", [jobId, settlement.outcome === "pay_doer" ? "completed" : "refunded"]);
      await client.query("INSERT INTO job_events (job_id,event_type,details) VALUES ($1,'job.settled',$2)", [jobId, JSON.stringify({ outcome: settlement.outcome, recipient: settlement.recipient, payoutTransaction: settlement.payout_tx_hash })]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) {
    await db.query("UPDATE job_settlements SET lease_until=NULL,error=$2,updated_at=now() WHERE job_id=$1", [jobId, String(error).slice(0, 2_000)]);
    throw error;
  }
}

export async function reconcileSettlements() {
  const result = await db.query<{ job_id: string }>(
    `SELECT job_id FROM job_settlements WHERE status='pending' AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 20`);
  for (const row of result.rows) void processSettlement(row.job_id).catch((error) => console.error(`Settlement ${row.job_id} retry failed:`, error));
}
