import type { PoolClient } from "pg";
import { formatUnits } from "viem";
import { z } from "zod";
import { config } from "./config.js";
import { parseUsdgAmount, usdgAmountSchema } from "./currency.js";
import { db } from "./db/index.js";
import { ApiError } from "./http.js";

export type Queryable = { query: PoolClient["query"] };

export const uuid = z.string().uuid();
export const amountInput = usdgAmountSchema;
// Every amount a client lists (job, task pay, milestone, contract rate) must reach MIN_AMOUNT_USDG. Dust amounts
// cost the platform more in payout gas than they move, and made self-dealt micro-jobs a cheap way to farm referrals.
export function toRaw(value: string) {
  const raw = parseUsdgAmount(value, config.USDG_DECIMALS);
  if (raw < parseUsdgAmount(config.MIN_AMOUNT_USDG, config.USDG_DECIMALS))
    throw new ApiError(400, "amount_below_minimum", `Amounts must be at least ${config.MIN_AMOUNT_USDG} USDG.`);
  return raw;
}
export const fromRaw = (raw: string | bigint) => formatUnits(BigInt(raw), config.USDG_DECIMALS);
export const usdg = (raw: string | bigint) => ({ amount: fromRaw(raw), amountRaw: BigInt(raw).toString() });

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const HANDLE = /^[a-z0-9_]{3,24}$/;
export const RESERVED_HANDLES = new Set(["admin", "gigwork", "team", "support", "root", "system", "official"]);

// Resolve "@handle", "handle" or a 0x wallet to a user. Wallets get an account on first reference.
export async function resolveUser(client: Queryable, reference: string) {
  const value = reference.trim().toLowerCase().replace(/^@/, "");
  if (/^0x[a-f0-9]{40}$/.test(value)) {
    const user = await client.query<{ id: string; wallet_address: string; handle: string | null }>(
      `INSERT INTO users (wallet_address) VALUES ($1)
       ON CONFLICT (wallet_address) DO UPDATE SET wallet_address=EXCLUDED.wallet_address
       RETURNING id,wallet_address,handle`,
      [value],
    );
    return user.rows[0];
  }
  if (!HANDLE.test(value)) throw new ApiError(400, "invalid_user_reference", "Use a pay handle such as @maya or a 0x wallet address.");
  const user = await client.query<{ id: string; wallet_address: string; handle: string | null }>(
    "SELECT id,wallet_address,handle FROM users WHERE handle=$1",
    [value],
  );
  if (!user.rowCount) throw new ApiError(404, "handle_not_found", `No GigWork account uses the handle @${value}.`);
  return user.rows[0];
}

export const party = (wallet: string | null, handle: string | null) =>
  wallet ? { wallet, handle: handle ? `@${handle}` : null } : null;

export const encryptionContext = (kind: string, id: string) => `${kind}:${id}`;

// Record a team action that changes who gets paid or who reviews. Kept in the same transaction as the change.
export async function logTeamAction(client: Queryable, actorId: string, action: string, subjectId: string | null, details: Record<string, unknown> = {}) {
  await client.query("INSERT INTO team_actions (actor_id,action,subject_id,details) VALUES ($1,$2,$3,$4)", [
    actorId, action, subjectId, JSON.stringify(details),
  ]);
}

// Per-client cap on new paid items per day, so nobody can queue unlimited payouts against the shared gas wallet.
export async function assertDailyCreateLimit(client: Queryable, userId: string) {
  const result = await client.query<{ count: string }>(
    `SELECT (
       (SELECT count(*) FROM jobs WHERE client_id=$1 AND created_at>now()-interval '1 day') +
       (SELECT count(*) FROM batches WHERE client_id=$1 AND created_at>now()-interval '1 day') +
       (SELECT count(*) FROM gigs WHERE client_id=$1 AND created_at>now()-interval '1 day') +
       (SELECT count(*) FROM contracts WHERE client_id=$1 AND created_at>now()-interval '1 day')
     )::text AS count`,
    [userId],
  );
  if (Number(result.rows[0].count) >= config.DAILY_CREATE_LIMIT)
    throw new ApiError(429, "daily_limit_reached", `You can post up to ${config.DAILY_CREATE_LIMIT} new items a day. Try again tomorrow.`);
}
