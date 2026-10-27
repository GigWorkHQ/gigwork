import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";
import { amountInput, fromRaw, party, resolveUser, toRaw, uuid, withTransaction, type Queryable } from "./common.js";
import { createEscrowAccount, createTransfer, kickEscrow, transfersFor, verifyDeposit } from "./ledger.js";

// Ongoing contracts paid by Pay runs: the client reserves each pay period in escrow before it starts, and the
// period pays the worker automatically when it ends. Rate changes need the worker's consent and apply only to
// periods reserved afterwards. Ending a contract never claws back a period that has already started.

const MAX_FUTURE_PERIODS = 6;

const createInput = z.object({
  worker: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(20_000),
  rate: amountInput,
  periodDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
});

type ContractRow = {
  id: string; client_id: string; worker_id: string; escrow_id: string; title: string; description: string; rate_raw: string;
  period_days: number; status: string; starts_at: Date | null; proposed_rate_raw: string | null; proposed_at: Date | null;
  ended_at: Date | null; ended_by: string | null; created_at: Date; escrow_address: string;
  client_wallet: string; client_handle: string | null; worker_wallet: string; worker_handle: string | null;
};
type PeriodRow = { id: string; number: number; starts_at: Date; ends_at: Date; amount_raw: string; status: string; reserved_at: Date | null; settled_at: Date | null };

const contractSelect = `SELECT k.*, k.rate_raw::text, k.proposed_rate_raw::text, e.address AS escrow_address,
    c.wallet_address AS client_wallet, c.handle AS client_handle, w.wallet_address AS worker_wallet, w.handle AS worker_handle
  FROM contracts k JOIN escrow_accounts e ON e.id=k.escrow_id JOIN users c ON c.id=k.client_id JOIN users w ON w.id=k.worker_id`;

// Next period starts when the last reserved one ends, or now if coverage has lapsed.
export function nextPeriodWindow(lastEnd: Date | null, periodDays: number, now = new Date()) {
  const startsAt = lastEnd && lastEnd > now ? lastEnd : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + periodDays * 86_400_000) };
}

async function presentContract(row: ContractRow, viewerId: string) {
  const periods = await db.query<PeriodRow>(
    "SELECT id,number,starts_at,ends_at,amount_raw::text,status,reserved_at,settled_at FROM pay_periods WHERE contract_id=$1 ORDER BY number",
    [row.id],
  );
  const ids = periods.rows.map((p) => p.id);
  const [payouts, deposits] = await Promise.all([
    transfersFor(ids),
    db.query<{ ref_id: string; tx_hash: string }>("SELECT ref_id,tx_hash FROM escrow_deposits WHERE purpose='pay_period' AND ref_id=ANY($1::uuid[])", [ids]),
  ]);
  const funding = new Map(deposits.rows.map((d) => [d.ref_id, d.tx_hash]));
  const lastEnd = periods.rows.filter((p) => ["reserved", "paid"].includes(p.status)).at(-1)?.ends_at ?? null;
  const next = nextPeriodWindow(lastEnd, row.period_days);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    role: viewerId === row.client_id ? "client" : "worker",
    client: party(row.client_wallet, row.client_handle),
    worker: party(row.worker_wallet, row.worker_handle),
    rate: fromRaw(row.rate_raw),
    rateRaw: row.rate_raw,
    periodDays: row.period_days,
    status: row.status,
    startsAt: row.starts_at,
    proposedRate: row.proposed_rate_raw ? fromRaw(row.proposed_rate_raw) : null,
    proposedAt: row.proposed_at,
    endedAt: row.ended_at,
    endedByClient: row.ended_by ? row.ended_by === row.client_id : null,
    escrowAddress: row.escrow_address,
    tokenAddress: config.USDG_TOKEN_ADDRESS.toLowerCase(),
    createdAt: row.created_at,
    nextPeriod: row.status === "active" ? { startsAt: next.startsAt, endsAt: next.endsAt, amount: fromRaw(row.rate_raw), amountRaw: row.rate_raw } : null,
    periods: periods.rows.map((p) => ({
      id: p.id, number: p.number, startsAt: p.starts_at, endsAt: p.ends_at, amount: fromRaw(p.amount_raw), status: p.status,
      reservedAt: p.reserved_at, settledAt: p.settled_at, fundingTransaction: funding.get(p.id) ?? null, payouts: payouts.get(p.id) ?? [],
    })),
  };
}

async function loadContract(id: string, userId: string, client: Queryable = db, lock = false) {
  const result = await client.query<ContractRow>(`${contractSelect} WHERE k.id=$1${lock ? " FOR UPDATE OF k" : ""}`, [id]);
  const row = result.rows[0];
  if (!row || ![row.client_id, row.worker_id].includes(userId)) throw new ApiError(404, "contract_not_found", "This contract does not exist.");
  return row;
}

async function settlePeriod(client: PoolClient, contract: ContractRow, period: PeriodRow, outcome: "paid" | "refunded") {
  await client.query("UPDATE pay_periods SET status=$2,settled_at=now() WHERE id=$1", [period.id, outcome]);
  await createTransfer(client, outcome === "paid"
    ? { escrowId: contract.escrow_id, kind: "pay_period", refId: period.id, recipientId: contract.worker_id, recipient: contract.worker_wallet, amountRaw: period.amount_raw }
    : { escrowId: contract.escrow_id, kind: "pay_period_refund", refId: period.id, recipientId: contract.client_id, recipient: contract.client_wallet, amountRaw: period.amount_raw });
}

export const contractsRouter = Router();
contractsRouter.use(requireAuth);

contractsRouter.post("/", asyncRoute(async (request, response) => {
  const input = createInput.parse(request.body);
  const rate = toRaw(input.rate);
  const id = await withTransaction(async (client) => {
    const worker = await resolveUser(client, input.worker);
    if (worker.id === request.auth!.userId) throw new ApiError(400, "cannot_hire_self", "You cannot offer a contract to yourself.");
    const escrow = await createEscrowAccount(client, "contract");
    const created = await client.query<{ id: string }>(
      `INSERT INTO contracts (client_id,worker_id,escrow_id,title,description,rate_raw,period_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [request.auth!.userId, worker.id, escrow.id, input.title, input.description, rate.toString(), input.periodDays],
    );
    return created.rows[0].id;
  });
  response.status(201).json({ data: await presentContract(await loadContract(id, request.auth!.userId), request.auth!.userId) });
}));

contractsRouter.get("/mine", asyncRoute(async (request, response) => {
  const result = await db.query<ContractRow>(
    `${contractSelect} WHERE k.client_id=$1 OR k.worker_id=$1 ORDER BY k.updated_at DESC LIMIT 100`,
    [request.auth!.userId],
  );
  response.json({ data: await Promise.all(result.rows.map((row) => presentContract(row, request.auth!.userId))) });
}));

contractsRouter.get("/:id", asyncRoute(async (request, response) => {
  const row = await loadContract(uuid.parse(request.params.id), request.auth!.userId);
  response.json({ data: await presentContract(row, request.auth!.userId) });
}));

function contractAction(
  action: (client: PoolClient, contract: ContractRow, userId: string, body: any) => Promise<string | void>,
) {
  return asyncRoute(async (request, response) => {
    const id = uuid.parse(request.params.id);
    const escrowToKick = await withTransaction(async (client) => {
      const contract = await loadContract(id, request.auth!.userId, client, true);
      return action(client, contract, request.auth!.userId, request.body ?? {});
    });
    if (escrowToKick) kickEscrow(escrowToKick);
    response.json({ data: await presentContract(await loadContract(id, request.auth!.userId), request.auth!.userId) });
  });
}

const workerOnly = (c: ContractRow, userId: string) => {
  if (c.worker_id !== userId) throw new ApiError(403, "worker_only", "Only the worker can do this.");
};
const clientOnly = (c: ContractRow, userId: string) => {
  if (c.client_id !== userId) throw new ApiError(403, "client_only", "Only the client can do this.");
};

contractsRouter.post("/:id/accept", contractAction(async (client, c, userId) => {
  workerOnly(c, userId);
  if (c.status !== "offered") throw new ApiError(409, "contract_not_offered", "This offer is no longer open.");
  await client.query("UPDATE contracts SET status='active',starts_at=now(),updated_at=now() WHERE id=$1", [c.id]);
}));

contractsRouter.post("/:id/decline", contractAction(async (client, c, userId) => {
  if (c.status !== "offered") throw new ApiError(409, "contract_not_offered", "This offer is no longer open.");
  const status = userId === c.worker_id ? "declined" : "withdrawn";
  await client.query("UPDATE contracts SET status=$2,ended_at=now(),ended_by=$3,updated_at=now() WHERE id=$1", [c.id, status, userId]);
}));

// Reserve the next pay period: the client sends exactly the current rate to the contract escrow.
contractsRouter.post("/:id/periods", contractAction(async (client, c, userId, body) => {
  clientOnly(c, userId);
  if (c.status !== "active") throw new ApiError(409, "contract_not_active", "Only an active contract can reserve pay periods.");
  const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(body.transactionHash);
  const existing = await client.query<{ number: number; ends_at: Date; status: string; starts_at: Date }>(
    "SELECT number,ends_at,status,starts_at FROM pay_periods WHERE contract_id=$1 ORDER BY number",
    [c.id],
  );
  const now = new Date();
  if (existing.rows.filter((p) => p.status === "reserved" && p.starts_at > now).length >= MAX_FUTURE_PERIODS)
    throw new ApiError(409, "too_many_reserved", `At most ${MAX_FUTURE_PERIODS} future periods can be reserved.`);
  const lastEnd = existing.rows.filter((p) => ["reserved", "paid"].includes(p.status)).at(-1)?.ends_at ?? null;
  const window = nextPeriodWindow(lastEnd, c.period_days, now);
  const number = (existing.rows.at(-1)?.number ?? 0) + 1;
  const period = await client.query<{ id: string }>(
    `INSERT INTO pay_periods (contract_id,number,starts_at,ends_at,amount_raw,status,reserved_at)
     VALUES ($1,$2,$3,$4,$5,'reserved',now()) RETURNING id`,
    [c.id, number, window.startsAt, window.endsAt, c.rate_raw],
  );
  await verifyDeposit(client, {
    escrowId: c.escrow_id, escrowAddress: c.escrow_address, purpose: "pay_period", refId: period.rows[0].id,
    clientWallet: c.client_wallet, amountRaw: c.rate_raw, txHash,
  });
}));

contractsRouter.post("/:id/rate", contractAction(async (client, c, userId, body) => {
  clientOnly(c, userId);
  if (c.status !== "active") throw new ApiError(409, "contract_not_active", "Only an active contract can change rate.");
  const rate = toRaw(amountInput.parse(body.rate));
  if (rate.toString() === c.rate_raw) throw new ApiError(400, "same_rate", "That is already the current rate.");
  await client.query("UPDATE contracts SET proposed_rate_raw=$2,proposed_at=now(),updated_at=now() WHERE id=$1", [c.id, rate.toString()]);
}));

contractsRouter.post("/:id/rate/respond", contractAction(async (client, c, userId, body) => {
  workerOnly(c, userId);
  const accept = z.boolean().parse(body.accept);
  if (!c.proposed_rate_raw) throw new ApiError(409, "no_rate_proposal", "There is no rate change to respond to.");
  await client.query(
    `UPDATE contracts SET rate_raw=CASE WHEN $2 THEN proposed_rate_raw ELSE rate_raw END,
       proposed_rate_raw=NULL,proposed_at=NULL,updated_at=now() WHERE id=$1`,
    [c.id, accept],
  );
}));

contractsRouter.post("/:id/end", contractAction(async (client, c, userId) => {
  if (c.status !== "active") throw new ApiError(409, "contract_not_active", "Only an active contract can be ended.");
  await client.query(
    "UPDATE contracts SET status='ended',ended_at=now(),ended_by=$2,proposed_rate_raw=NULL,proposed_at=NULL,updated_at=now() WHERE id=$1",
    [c.id, userId],
  );
  // Periods that have not started are refunded; a running period still pays the worker when it ends.
  const future = await client.query<PeriodRow>(
    "SELECT id,number,starts_at,ends_at,amount_raw::text,status,reserved_at,settled_at FROM pay_periods WHERE contract_id=$1 AND status='reserved' AND starts_at>now() FOR UPDATE",
    [c.id],
  );
  for (const period of future.rows) await settlePeriod(client, c, period, "refunded");
  return future.rowCount ? c.escrow_id : undefined;
}));

// Keeper step: pay every reserved period that has ended. This is the Pay run.
export async function runPayRuns() {
  const due = await db.query<{ id: string; contract_id: string }>(
    "SELECT id,contract_id FROM pay_periods WHERE status='reserved' AND ends_at<=now() ORDER BY ends_at LIMIT 200",
  );
  const escrows = new Set<string>();
  for (const row of due.rows) {
    const escrowId = await withTransaction(async (client) => {
      const period = await client.query<PeriodRow>(
        "SELECT id,number,starts_at,ends_at,amount_raw::text,status,reserved_at,settled_at FROM pay_periods WHERE id=$1 FOR UPDATE",
        [row.id],
      );
      if (period.rows[0]?.status !== "reserved") return null;
      const contract = await client.query<ContractRow>(`${contractSelect} WHERE k.id=$1`, [row.contract_id]);
      await settlePeriod(client, contract.rows[0], period.rows[0], "paid");
      return contract.rows[0].escrow_id;
    });
    if (escrowId) escrows.add(escrowId);
  }
  for (const escrowId of escrows) kickEscrow(escrowId);
}
