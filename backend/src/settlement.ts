import { encodeFunctionData, erc20Abi, keccak256, type Address, type Hash, type Hex } from "viem";
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

const waitFor = async (hash: Hash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.RH_CONFIRMATIONS });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
  return receipt;
};

async function sendPersisted(raw: Hex, hash: Hash) {
  try { await publicClient.sendRawTransaction({ serializedTransaction: raw }); }
  catch (error) {
    const message = String(error).toLowerCase();
    if (!message.includes("already known") && !message.includes("known transaction") && !message.includes("nonce too low")) throw error;
  }
  return waitFor(hash);
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
    await client.query("SELECT pg_advisory_xact_lock(73301822)");
    const current = await client.query<any>(`SELECT ${nonceColumn},${signedColumn},${hashColumn} FROM job_settlements WHERE job_id=$1 FOR UPDATE`, [jobId]);
    if (current.rows[0][signedColumn]) {
      await client.query("COMMIT");
      return { raw: current.rows[0][signedColumn] as Hex, hash: current.rows[0][hashColumn] as Hash };
    }
    const pending = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    const previous = stage === "gas"
      ? await client.query<{ next_nonce: string | null }>(`SELECT (MAX(gas_nonce)+1)::text AS next_nonce FROM job_settlements WHERE gas_nonce IS NOT NULL`)
      : await client.query<{ next_nonce: string | null }>(
          `SELECT (GREATEST(COALESCE(payout_nonce,-1),COALESCE(sweep_nonce,-1))+1)::text AS next_nonce FROM job_settlements WHERE job_id=$1`, [jobId]);
    const nonce = Math.max(pending, previous.rows[0].next_nonce ? Number(previous.rows[0].next_nonce) : 0);
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

export async function processSettlement(jobId: string) {
  const lease = await db.query(
    `UPDATE job_settlements SET lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
     WHERE job_id=$1 AND status='pending' AND (lease_until IS NULL OR lease_until<now()) RETURNING id`, [jobId]);
  if (!lease.rowCount) return;
  try {
    let settlement = await load(jobId);
    if (!settlement) throw new Error("Settlement record is missing.");
    const escrow = loadEscrowAccount(jobId, settlement.encrypted_private_key);
    const gasPrice = await publicClient.getGasPrice();
    const tokenData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [settlement.recipient, BigInt(settlement.amount_raw)],
    });
    const payoutGas = 100_000n;
    const sweepGas = 21_000n;

    {
      const reserve = gasPrice * (payoutGas + sweepGas + 30_000n) * 2n;
      const gasTx = await ensureStageTx(settlement, "gas", {
        to: settlement.escrow_address, value: reserve, gas: 21_000n, gasPrice,
      }, gasAccount);
      await sendPersisted(gasTx.raw, gasTx.hash);
      await db.query("UPDATE job_settlements SET phase='payout',updated_at=now() WHERE job_id=$1", [jobId]);
    }

    settlement = await load(jobId);
    {
      const payout = await ensureStageTx(settlement, "payout", {
        to: settlement.token_address,
        value: 0n,
        data: tokenData,
        gas: payoutGas,
        gasPrice,
      }, escrow);
      await sendPersisted(payout.raw, payout.hash);
      await db.query("UPDATE job_settlements SET phase='sweep',updated_at=now() WHERE job_id=$1", [jobId]);
    }

    settlement = await load(jobId);
    if (settlement.sweep_signed_tx && settlement.sweep_tx_hash) {
      await sendPersisted(settlement.sweep_signed_tx, settlement.sweep_tx_hash);
    } else {
      const balance = await publicClient.getBalance({ address: settlement.escrow_address });
      const sweepValue = balance - gasPrice * sweepGas;
      if (sweepValue > 0n) {
        const sweep = await ensureStageTx(settlement, "sweep", {
          to: gasWalletAddress, value: sweepValue, gas: sweepGas, gasPrice,
        }, escrow);
        await sendPersisted(sweep.raw, sweep.hash);
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
