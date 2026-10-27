import { randomUUID } from "node:crypto";
import { erc20Abi, keccak256, type Address, type Hash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { db } from "./db/index.js";
import { gasAccount, publicClient, verifyJobFunding } from "./escrow.js";
import { ApiError } from "./http.js";
import type { Queryable } from "./common.js";
import { GAS_WALLET_LOCK, RevertedError, gasNonceFloor, sendPersisted, usdgPayoutTransaction } from "./settlement.js";

// Multi-payout escrow accounts. Each batch, gig and contract gets its own key-encrypted wallet that
// receives exact client deposits and pays workers through persisted, replay-safe ERC-20 transfers.

export type EscrowKind = "batch" | "gig" | "contract" | "bonus_vault";
export type TransferKind =
  | "assignment_pay" | "batch_refund" | "milestone_pay" | "milestone_refund"
  | "pay_period" | "pay_period_refund" | "referral_bonus";

const PAYOUT_GAS = 100_000n;
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
  return verified;
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
    await sendPersisted(topup.signed_tx, topup.tx_hash);
    await db.query("UPDATE gas_topups SET status='complete' WHERE id=$1", [topup.id]);
  }
}

async function ensureGas(escrowId: string, address: Address, gasPrice: bigint, remaining: number) {
  await finishGasTopups(escrowId);
  const perTransfer = gasPrice * PAYOUT_GAS * 2n;
  const balance = await publicClient.getBalance({ address });
  if (balance >= perTransfer) return;
  const amount = perTransfer * BigInt(Math.min(Math.max(remaining, 1), 10));
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [GAS_WALLET_LOCK]);
    const pendingCount = await publicClient.getTransactionCount({ address: gasAccount.address, blockTag: "pending" });
    const nonce = Math.max(pendingCount, await gasNonceFloor(client));
    const raw = await gasAccount.signTransaction({ to: address, value: amount, gas: 21_000n, gasPrice, nonce, chainId: config.RH_CHAIN_ID, type: "legacy" });
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
            const gasPrice = await publicClient.getGasPrice();
            await ensureGas(escrowId, leased.rows[0].address, gasPrice, pending.rowCount - index);
            signed = await signTransfer(escrowId, transfer, account, gasPrice);
          }
          await sendPersisted(signed.raw, signed.hash);
          await db.query("UPDATE escrow_transfers SET status='complete',error=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [transfer.id]);
        } catch (error) {
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
