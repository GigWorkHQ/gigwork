import { randomUUID } from "node:crypto";
import { erc20Abi, keccak256, type Address, type Hash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { db } from "./db/index.js";
import { gasAccount, publicClient, verifyJobFunding } from "./escrow.js";
import { ApiError } from "./http.js";
import { withTransaction, type Queryable } from "./common.js";
import { ETH_TRANSFER_GAS, GAS_WALLET_LOCK, RevertedError, StaleTxError, USDG_TRANSFER_GAS, nextGasNonce, payableGasPrice, sendPersisted, usdgPayoutTransaction } from "./settlement.js";

// Multi-payout escrow accounts. Each batch, gig and contract gets its own key-encrypted wallet that
// receives exact client deposits and pays workers through persisted, replay-safe ERC-20 transfers.

export type EscrowKind = "batch" | "gig" | "contract" | "bonus_vault" | "job";
export type TransferKind =
  | "assignment_pay" | "batch_refund" | "milestone_pay" | "milestone_refund"
  | "pay_period" | "pay_period_refund" | "referral_bonus" | "surplus_refund";

const escrowContext = (id: string) => `escrow:${id}`;

export async function createEscrowAccount(client: Queryable, kind: EscrowKind) {
  const id = randomUUID();
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  await client.query("INSERT INTO escrow_accounts (id,kind,address,encrypted_private_key) VALUES ($1,$2,$3,$4)", [
    id,
    kind,
    address,
    encryptSecret(privateKey, escrowContext(id)),
  ]);
  return { id, address };
}

// Register a settled job's wallet as an escrow account (once), so leftover USDG goes through recoverSurplus. Only
// called after the job's settlement is complete: the settlement no longer signs from this wallet, and nothing is owed
// from it, so its whole balance is surplus. The key is re-encrypted under the escrow context; the wallet is the same.
export async function jobEscrowAccount(client: Queryable, jobId: string) {
  const existing = await client.query<{ id: string }>("SELECT id FROM escrow_accounts WHERE job_id=$1", [jobId]);
  if (existing.rowCount) return existing.rows[0].id;
  const wallet = await client.query<{ address: string; encrypted_private_key: string }>(
    "SELECT address,encrypted_private_key FROM job_escrow_wallets WHERE job_id=$1", [jobId]);
  if (!wallet.rowCount) throw new ApiError(404, "job_not_found", "This job does not exist.");
  const id = randomUUID();
  const privateKey = decryptSecret(wallet.rows[0].encrypted_private_key, `job-escrow:${jobId}`);
  await client.query("INSERT INTO escrow_accounts (id,kind,address,encrypted_private_key,job_id) VALUES ($1,'job',$2,$3,$4)", [
    id, wallet.rows[0].address, encryptSecret(privateKey, escrowContext(id)), jobId,
  ]);
  return id;
}

export async function bonusVault() {
  const existing = await db.query<{ id: string; address: string }>("SELECT id,address FROM escrow_accounts WHERE kind='bonus_vault'");
  if (existing.rowCount) return existing.rows[0];
  try {
    return await createEscrowAccount(db, "bonus_vault");
  } catch {
    const created = await db.query<{ id: string; address: string }>("SELECT id,address FROM escrow_accounts WHERE kind='bonus_vault'");
    return created.rows[0];
  }
}

export async function usdgBalance(address: string) {
  return publicClient.readContract({
    address: config.USDG_TOKEN_ADDRESS as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as Address],
  });
}

// Where an escrow stands: its on-chain balance, what it still owes from recorded deposits, and any USDG above that.
// Owed = recorded deposits minus payouts already on-chain, plus surplus refunds not yet sent. A pending payout counts
// as paid only once its own transaction is mined, so a surplus is never overstated while a payout is in flight.
export async function escrowPosition(client: Queryable, escrowId: string, address: string) {
  const [balance, sums, inFlight] = await Promise.all([
    usdgBalance(address),
    client.query<{ deposits: string; paid: string; surplus_owed: string }>(
      `SELECT
         COALESCE((SELECT sum(amount_raw) FROM escrow_deposits WHERE escrow_id=$1),0)::text AS deposits,
         COALESCE((SELECT sum(amount_raw) FROM escrow_transfers WHERE escrow_id=$1 AND status='complete' AND kind<>'surplus_refund'),0)::text AS paid,
         COALESCE((SELECT sum(amount_raw) FROM escrow_transfers WHERE escrow_id=$1 AND status<>'complete' AND kind='surplus_refund'),0)::text AS surplus_owed`,
      [escrowId],
    ),
    client.query<{ amount_raw: string; tx_hash: Hash; kind: string }>(
      "SELECT amount_raw::text,tx_hash,kind FROM escrow_transfers WHERE escrow_id=$1 AND status='pending' AND tx_hash IS NOT NULL",
      [escrowId],
    ),
  ]);
  let minedPayouts = 0n;
  let minedSurplus = 0n;
  for (const transfer of inFlight.rows) {
    const receipt = await publicClient.getTransactionReceipt({ hash: transfer.tx_hash }).catch(() => null);
    if (receipt?.status !== "success") continue;
    if (transfer.kind === "surplus_refund") minedSurplus += BigInt(transfer.amount_raw);
    else minedPayouts += BigInt(transfer.amount_raw);
  }
  const deposits = BigInt(sums.rows[0].deposits);
  const paid = BigInt(sums.rows[0].paid) + minedPayouts;
  const surplusOwed = BigInt(sums.rows[0].surplus_owed) - minedSurplus;
  const owed = deposits - paid + surplusOwed;
  return { balance, owed, surplus: balance - owed };
}

// Serialise everything that changes what an escrow owes (deposit records, surplus refunds) on its account row.
export async function lockEscrow(client: Queryable, escrowId: string) {
  const row = await client.query<{ address: string; kind: EscrowKind }>("SELECT address,kind FROM escrow_accounts WHERE id=$1 FOR UPDATE", [escrowId]);
  if (!row.rowCount) throw new ApiError(404, "escrow_not_found", "This escrow does not exist.");
  return row.rows[0];
}

// Verify an exact USDG transfer from the client into an escrow and record it against one purpose.
export async function verifyDeposit(
  client: Queryable,
  input: { escrowId: string; escrowAddress: string; purpose: "batch" | "milestone" | "pay_period"; refId: string; clientWallet: string; amountRaw: string; txHash: string },
) {
  const verified = await verifyJobFunding(
    { id: input.refId, client_wallet: input.clientWallet, asset: "usdg", amount_raw: input.amountRaw, token_address: config.USDG_TOKEN_ADDRESS.toLowerCase() },
    input.escrowAddress,
    input.txHash,
  );
  await lockEscrow(client, input.escrowId);
  try {
    await client.query(
      `INSERT INTO escrow_deposits (escrow_id,purpose,ref_id,tx_hash,from_wallet,amount_raw,block_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.escrowId, input.purpose, input.refId, verified.hash, input.clientWallet.toLowerCase(), input.amountRaw, verified.blockNumber],
    );
  } catch (error: any) {
    if (error?.code === "23505") throw new ApiError(409, "funding_tx_used", "This transaction has already been used to fund something else.");
    throw error;
  }
  // The escrow must still hold the money this deposit claims: a transfer whose USDG was already returned by a surplus
  // recovery cannot be recorded afterwards as funding.
  const position = await escrowPosition(client, input.escrowId, input.escrowAddress).catch(() => {
    throw new ApiError(503, "chain_unavailable", "Couldn't read the escrow balance just now. Try again in a moment.");
  });
  if (position.surplus < 0n)
    throw new ApiError(409, "funding_not_held", "The escrow no longer holds this deposit. It may have been returned to you already.");
  return verified;
}

// Return USDG an escrow holds above what it owes to the client who owns it. Covers transfers that were never recorded:
// a batch closed before /fund, a contract ended with a period's rate already sent, a wrong amount, or a deposit from a
// Safe or smart wallet that verifyDeposit cannot match (audit M-2).
export async function recoverSurplus(escrowId: string, requester: { userId: string; wallet: string }) {
  const result = await withTransaction(async (client) => {
    const escrow = await lockEscrow(client, escrowId);
    if (escrow.kind === "bonus_vault") throw new ApiError(403, "not_recoverable", "The bonus budget cannot be recovered this way.");
    const position = await escrowPosition(client, escrowId, escrow.address);
    if (position.surplus <= 0n) throw new ApiError(409, "nothing_to_recover", "This escrow holds nothing beyond what it owes.");
    const recovery = await client.query<{ id: string }>(
      "INSERT INTO escrow_recoveries (escrow_id,requested_by,amount_raw) VALUES ($1,$2,$3) RETURNING id",
      [escrowId, requester.userId, position.surplus.toString()],
    );
    await createTransfer(client, {
      escrowId, kind: "surplus_refund", refId: recovery.rows[0].id, recipientId: requester.userId, recipient: requester.wallet, amountRaw: position.surplus,
    });
    return { recoveryId: recovery.rows[0].id, amountRaw: position.surplus };
  });
  kickEscrow(escrowId);
  return result;
}

export async function depositFor(purpose: string, refId: string) {
  const result = await db.query<{ tx_hash: string }>("SELECT tx_hash FROM escrow_deposits WHERE purpose=$1 AND ref_id=$2", [purpose, refId]);
  return result.rows[0]?.tx_hash ?? null;
}

// Queue an escrow payout. Idempotent per (kind, refId). The caller's transaction commits it.
export async function createTransfer(
  client: Queryable,
  input: { escrowId: string; kind: TransferKind; refId: string; recipientId: string | null; recipient: string; amountRaw: bigint | string },
) {
  const amount = BigInt(input.amountRaw);
  if (amount <= 0n) return null;
  let note: string | null = null;
  if (input.recipientId && !input.kind.endsWith("refund")) {
    const election = await client.query<{ stock_symbol: string | null; stock_bps: number }>(
      "SELECT stock_symbol,stock_bps FROM payout_elections WHERE user_id=$1",
      [input.recipientId],
    );
    const choice = election.rows[0];
    if (choice?.stock_bps)
      note = `${choice.stock_bps / 100}% ${choice.stock_symbol} election paid in USDG: no verified stock-token swap route is enabled.`;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO escrow_transfers (escrow_id,kind,ref_id,recipient_id,recipient,amount_raw,payout_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (kind,ref_id) DO NOTHING RETURNING id`,
    [input.escrowId, input.kind, input.refId, input.recipientId, input.recipient.toLowerCase(), amount.toString(), note],
  );
  return inserted.rows[0]?.id ?? null;
}

export function kickEscrow(escrowId: string) {
  void processEscrow(escrowId).catch((error) => console.error(`Escrow ${escrowId} payout failed:`, error));
}

type TransferRow = { id: string; recipient: Address; amount_raw: string; nonce: string | null; signed_tx: Hex | null; tx_hash: Hash | null };

async function finishGasTopups(escrowId: string) {
  const pending = await db.query<{ id: string; signed_tx: Hex; tx_hash: Hash }>(
    "SELECT id,signed_tx,tx_hash FROM gas_topups WHERE escrow_id=$1 AND status='pending' ORDER BY nonce",
    [escrowId],
  );
  for (const topup of pending.rows) {
    try { await sendPersisted(topup.signed_tx, topup.tx_hash); }
    catch (error) {
      // It never reached the chain; drop it so ensureGas signs a new top-up if the escrow still needs one.
      if (error instanceof StaleTxError) await db.query("DELETE FROM gas_topups WHERE id=$1 AND status='pending'", [topup.id]);
      throw error;
    }
    await db.query("UPDATE gas_topups SET status='complete' WHERE id=$1", [topup.id]);
  }
}

async function ensureGas(escrowId: string, address: Address, gasPrice: bigint, remaining: number) {
  await finishGasTopups(escrowId);
  const perTransfer = gasPrice * USDG_TRANSFER_GAS * 2n;
  const balance = await publicClient.getBalance({ address });
  if (balance >= perTransfer) return;
  const amount = perTransfer * BigInt(Math.min(Math.max(remaining, 1), 10));
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [GAS_WALLET_LOCK]);
    const nonce = await nextGasNonce(client);
    const raw = await gasAccount.signTransaction({ to: address, value: amount, gas: ETH_TRANSFER_GAS, gasPrice, nonce, chainId: config.RH_CHAIN_ID, type: "legacy" });
    await client.query("INSERT INTO gas_topups (escrow_id,nonce,amount_wei,signed_tx,tx_hash) VALUES ($1,$2,$3,$4,$5)", [
      escrowId, nonce, amount.toString(), raw, keccak256(raw),
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await finishGasTopups(escrowId);
}

async function signTransfer(escrowId: string, transfer: TransferRow, account: ReturnType<typeof privateKeyToAccount>, gasPrice: bigint) {
  const pendingCount = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const previous = await db.query<{ next_nonce: string | null }>(
    "SELECT (MAX(nonce)+1)::text AS next_nonce FROM escrow_transfers WHERE escrow_id=$1 AND nonce IS NOT NULL",
    [escrowId],
  );
  const nonce = Math.max(pendingCount, previous.rows[0].next_nonce ? Number(previous.rows[0].next_nonce) : 0);
  const raw = await account.signTransaction({
    ...usdgPayoutTransaction(transfer.recipient, config.USDG_TOKEN_ADDRESS.toLowerCase() as Address, transfer.amount_raw, gasPrice),
    nonce,
    chainId: config.RH_CHAIN_ID,
    type: "legacy",
  });
  const hash = keccak256(raw);
  const saved = await db.query(
    "UPDATE escrow_transfers SET nonce=$2,signed_tx=$3,tx_hash=$4,updated_at=now() WHERE id=$1 AND signed_tx IS NULL",
    [transfer.id, nonce, raw, hash],
  );
  if (!saved.rowCount) throw new Error(`Transfer ${transfer.id} was signed concurrently.`);
  return { raw: raw as Hex, hash };
}

// Send every pending payout of one escrow, in order, under a lease so only one worker signs its nonces.
export async function processEscrow(escrowId: string) {
  const leased = await db.query<{ address: Address; encrypted_private_key: string }>(
    `UPDATE escrow_accounts SET lease_until=now()+interval '5 minutes'
     WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING address,encrypted_private_key`,
    [escrowId],
  );
  if (!leased.rowCount) return;
  const account = privateKeyToAccount(decryptSecret(leased.rows[0].encrypted_private_key, escrowContext(escrowId)) as Hex);
  try {
    for (;;) {
      const pending = await db.query<TransferRow>(
        `SELECT id,recipient,amount_raw::text,nonce,signed_tx,tx_hash FROM escrow_transfers
         WHERE escrow_id=$1 AND status='pending' ORDER BY (nonce IS NULL), nonce, created_at LIMIT 25`,
        [escrowId],
      );
      if (!pending.rowCount) return;
      for (const [index, transfer] of pending.rows.entries()) {
        await db.query("UPDATE escrow_accounts SET lease_until=now()+interval '5 minutes' WHERE id=$1", [escrowId]);
        await db.query("UPDATE escrow_transfers SET attempts=attempts+1,updated_at=now() WHERE id=$1", [transfer.id]);
        try {
          let signed = transfer.signed_tx && transfer.tx_hash ? { raw: transfer.signed_tx, hash: transfer.tx_hash } : null;
          if (!signed) {
            const gasPrice = await payableGasPrice();
            await ensureGas(escrowId, leased.rows[0].address, gasPrice, pending.rowCount - index);
            signed = await signTransfer(escrowId, transfer, account, gasPrice);
          }
          await sendPersisted(signed.raw, signed.hash);
          await db.query("UPDATE escrow_transfers SET status='complete',error=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [transfer.id]);
        } catch (error) {
          if (error instanceof StaleTxError)
            await db.query("UPDATE escrow_transfers SET nonce=NULL,signed_tx=NULL,tx_hash=NULL WHERE id=$1 AND status='pending'", [transfer.id]);
          const failed = error instanceof RevertedError;
          await db.query("UPDATE escrow_transfers SET status=$2,error=$3,updated_at=now() WHERE id=$1", [
            transfer.id, failed ? "failed" : "pending", String(error).slice(0, 2_000),
          ]);
          if (!failed) throw error;
        }
      }
    }
  } finally {
    await db.query("UPDATE escrow_accounts SET lease_until=NULL WHERE id=$1", [escrowId]);
  }
}

export async function reconcileTransfers() {
  const result = await db.query<{ escrow_id: string }>(
    `SELECT DISTINCT t.escrow_id FROM escrow_transfers t JOIN escrow_accounts e ON e.id=t.escrow_id
     WHERE t.status='pending' AND (e.lease_until IS NULL OR e.lease_until<now()) LIMIT 20`,
  );
  for (const row of result.rows) kickEscrow(row.escrow_id);
}

export type TransferView = { kind: string; status: string; amountRaw: string; recipient: string; transactionHash: string | null; note: string | null; completedAt: Date | null };
export async function transfersFor(refIds: string[]) {
  if (!refIds.length) return new Map<string, TransferView[]>();
  const result = await db.query<{ ref_id: string; kind: string; status: string; amount_raw: string; recipient: string; tx_hash: string | null; payout_note: string | null; completed_at: Date | null }>(
    "SELECT ref_id,kind,status,amount_raw::text,recipient,tx_hash,payout_note,completed_at FROM escrow_transfers WHERE ref_id=ANY($1::uuid[]) ORDER BY created_at",
    [refIds],
  );
  const map = new Map<string, TransferView[]>();
  for (const row of result.rows) {
    const list = map.get(row.ref_id) ?? [];
    list.push({ kind: row.kind, status: row.status, amountRaw: row.amount_raw, recipient: row.recipient, transactionHash: row.status === "complete" ? row.tx_hash : null, note: row.payout_note, completedAt: row.completed_at });
    map.set(row.ref_id, list);
  }
  return map;
}
