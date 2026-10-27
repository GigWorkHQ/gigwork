import { createHash, createHmac, randomBytes } from "node:crypto";
import { Router } from "express";
import { erc20Abi, parseEventLogs, type Hash } from "viem";
import { z } from "zod";
import { createApiKey, isTeamWallet, requireAuth, requireTeam, requireWalletSession } from "./auth.js";
import { config, stockExcludedCountries, stockTokens } from "./config.js";
import { db } from "./db/index.js";
import { parseHash, publicClient } from "./escrow.js";
import { ApiError, asyncRoute } from "./http.js";
import { HANDLE, RESERVED_HANDLES, fromRaw, toRaw, uuid, withTransaction } from "./common.js";
import { bonusVault, createTransfer, kickEscrow, usdgBalance } from "./ledger.js";

export const accountRouter = Router();
accountRouter.use(requireAuth);

// ---------- Profile and pay handles ----------

async function profile(userId: string, wallet: string) {
  const [user, reviewer, election] = await Promise.all([
    db.query<{ handle: string | null; referral_code: string | null; referred_by: string | null; created_at: Date }>(
      "SELECT handle,referral_code,referred_by,created_at FROM users WHERE id=$1", [userId]),
    db.query<{ active: boolean }>("SELECT active FROM reviewers WHERE user_id=$1", [userId]),
    db.query<{ stock_symbol: string | null; stock_bps: number; country: string | null }>(
      "SELECT stock_symbol,stock_bps,country FROM payout_elections WHERE user_id=$1", [userId]),
  ]);
  const u = user.rows[0];
  return {
    userId,
    wallet,
    handle: u.handle ? `@${u.handle}` : null,
    isTeam: isTeamWallet(wallet),
    isReviewer: Boolean(reviewer.rows[0]?.active),
    referred: Boolean(u.referred_by),
    payoutElection: election.rows[0]
      ? { stockSymbol: election.rows[0].stock_symbol, stockBps: election.rows[0].stock_bps, country: election.rows[0].country }
      : { stockSymbol: null, stockBps: 0, country: null },
    createdAt: u.created_at,
  };
}

accountRouter.get("/me", asyncRoute(async (request, response) => {
  response.json({ data: await profile(request.auth!.userId, request.auth!.walletAddress) });
}));

accountRouter.put("/me/handle", requireWalletSession, asyncRoute(async (request, response) => {
  const handle = z.string().trim().toLowerCase().transform((value) => value.replace(/^@/, "")).parse(request.body?.handle);
  if (!HANDLE.test(handle)) throw new ApiError(400, "invalid_handle", "Handles use 3–24 lowercase letters, numbers or underscores.");
  if (RESERVED_HANDLES.has(handle)) throw new ApiError(409, "handle_reserved", "That handle is reserved.");
  try {
    await db.query("UPDATE users SET handle=$2,updated_at=now() WHERE id=$1", [request.auth!.userId, handle]);
  } catch (error: any) {
    if (error?.code === "23505") throw new ApiError(409, "handle_taken", `@${handle} is already taken.`);
    throw error;
  }
  response.json({ data: await profile(request.auth!.userId, request.auth!.walletAddress) });
}));

// ---------- Agent API keys ----------

accountRouter.get("/me/api-keys", requireWalletSession, asyncRoute(async (request, response) => {
  const keys = await db.query<{ id: string; label: string; prefix: string; created_at: Date; last_used_at: Date | null }>(
    "SELECT id,label,prefix,created_at,last_used_at FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC",
    [request.auth!.userId],
  );
  response.json({ data: keys.rows.map((k) => ({ id: k.id, label: k.label, prefix: k.prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at })) });
}));

accountRouter.post("/me/api-keys", requireWalletSession, asyncRoute(async (request, response) => {
  const label = z.string().trim().min(1).max(80).parse(request.body?.label);
  const active = await db.query<{ count: string }>("SELECT count(*)::text FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL", [request.auth!.userId]);
  if (Number(active.rows[0].count) >= 10) throw new ApiError(409, "too_many_keys", "Revoke an existing key before creating another (limit 10).");
  // The full key is returned once and only its hash is stored.
  response.status(201).json({ data: await createApiKey(request.auth!.userId, label) });
}));

accountRouter.delete("/me/api-keys/:id", requireWalletSession, asyncRoute(async (request, response) => {
  await db.query("UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [uuid.parse(request.params.id), request.auth!.userId]);
  response.status(204).end();
}));

// ---------- Payout election (stock-token share) ----------

accountRouter.get("/payouts/options", asyncRoute(async (request, response) => {
  response.json({ data: {
    stockTokens: stockTokens.map((t) => ({ symbol: t.symbol, address: t.address })),
    routeEnabled: false,
    maxStockBps: 5000,
    excludedCountries: [...stockExcludedCountries],
    election: (await profile(request.auth!.userId, request.auth!.walletAddress)).payoutElection,
  } });
}));

accountRouter.put("/payouts/election", requireWalletSession, asyncRoute(async (request, response) => {
  const input = z.object({
    stockSymbol: z.string().trim().toUpperCase().nullable(),
    stockBps: z.number().int().min(0).max(5000),
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    acknowledgeRisk: z.boolean().default(false),
  }).parse(request.body);
  if (input.stockBps === 0 || !input.stockSymbol) {
    await db.query(
      `INSERT INTO payout_elections (user_id,stock_symbol,stock_bps,country) VALUES ($1,NULL,0,$2)
       ON CONFLICT (user_id) DO UPDATE SET stock_symbol=NULL,stock_bps=0,country=$2,updated_at=now()`,
      [request.auth!.userId, input.country],
    );
  } else {
    if (!stockTokens.some((t) => t.symbol === input.stockSymbol))
      throw new ApiError(409, "stock_token_unavailable", "That stock token is not offered. Payouts stay in USDG.");
    if (stockExcludedCountries.has(input.country))
      throw new ApiError(403, "stock_region_ineligible", "Stock-token payouts are not available in your country. Payouts stay in USDG.");
    if (!input.acknowledgeRisk)
      throw new ApiError(400, "risk_acknowledgement_required", "Confirm you understand stock tokens are issuer products whose price can fall.");
    await db.query(
      `INSERT INTO payout_elections (user_id,stock_symbol,stock_bps,country,risk_acknowledged_at) VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (user_id) DO UPDATE SET stock_symbol=$2,stock_bps=$3,country=$4,risk_acknowledged_at=now(),updated_at=now()`,
      [request.auth!.userId, input.stockSymbol, input.stockBps, input.country],
    );
  }
  response.json({ data: (await profile(request.auth!.userId, request.auth!.walletAddress)).payoutElection });
}));

// ---------- Earnings / pay statements ----------

const transferKindLabel: Record<string, string> = {
  assignment_pay: "Quick task", batch_refund: "Batch refund", milestone_pay: "Milestone", milestone_refund: "Milestone refund",
  pay_period: "Pay run", pay_period_refund: "Pay period refund", referral_bonus: "Referral bonus", job: "Job", job_refund: "Job refund",
};

accountRouter.get("/payouts", asyncRoute(async (request, response) => {
  const rows = await db.query<{ kind: string; ref_id: string; amount_raw: string; status: string; tx_hash: string | null; payout_note: string | null; created_at: Date; completed_at: Date | null }>(
    `SELECT kind,ref_id,amount_raw::text,status,tx_hash,payout_note,created_at,completed_at FROM escrow_transfers WHERE recipient_id=$1
     UNION ALL
     SELECT CASE s.outcome WHEN 'pay_doer' THEN 'job' ELSE 'job_refund' END,s.job_id,s.amount_raw::text,s.status,s.payout_tx_hash,NULL,s.created_at,
       CASE WHEN s.status='complete' THEN s.updated_at END
     FROM job_settlements s WHERE s.recipient=$2
     ORDER BY created_at DESC LIMIT 500`,
    [request.auth!.userId, request.auth!.walletAddress.toLowerCase()],
  );
  const tips = await db.query<{ amount_raw: string; tx_hash: string; created_at: Date; subject_kind: string; message: string | null }>(
    "SELECT amount_raw::text,tx_hash,created_at,subject_kind,message FROM tips WHERE to_id=$1 ORDER BY created_at DESC LIMIT 200",
    [request.auth!.userId],
  );
  const complete = rows.rows.filter((r) => r.status === "complete");
  const pending = rows.rows.filter((r) => r.status === "pending");
  const sum = (list: { amount_raw: string }[]) => fromRaw(list.reduce((total, r) => total + BigInt(r.amount_raw), 0n));
  response.json({ data: {
    totals: { received: sum(complete), pending: sum(pending), tips: sum(tips.rows) },
    entries: rows.rows.map((r) => ({
      kind: r.kind, label: transferKindLabel[r.kind] ?? r.kind, refId: r.ref_id, amount: fromRaw(r.amount_raw), status: r.status,
      transactionHash: r.status === "complete" ? r.tx_hash : null, note: r.payout_note, createdAt: r.created_at, completedAt: r.completed_at,
    })),
    tips: tips.rows.map((t) => ({ amount: fromRaw(t.amount_raw), transactionHash: t.tx_hash, createdAt: t.created_at, subjectKind: t.subject_kind, message: t.message })),
  } });
}));

// ---------- Work history ----------
// Entries come only from escrow payouts that completed on-chain, so every entry has a verifiable transaction.

type HistoryEntry = { kind: string; ref: string; title: string; client: string; clientId: string; amountRaw: string; date: string; transactions: string[] };

export async function workHistory(userId: string): Promise<HistoryEntry[]> {
  const [jobs, assignments, milestones, periods] = await Promise.all([
    db.query<{ id: string; title: string; client: string; client_id: string; amount_raw: string; settled: Date; tx: string }>(
      `SELECT j.id,j.title,COALESCE('@'||c.handle,c.wallet_address) AS client,j.client_id,s.amount_raw::text,s.updated_at AS settled,s.payout_tx_hash AS tx
       FROM jobs j JOIN job_settlements s ON s.job_id=j.id JOIN users c ON c.id=j.client_id
       WHERE j.doer_id=$1 AND s.outcome='pay_doer' AND s.status='complete'`, [userId]),
    db.query<{ batch_id: string; title: string; task_type: string; client: string; client_id: string; amount_raw: string; settled: Date; txs: string[]; items: string }>(
      `SELECT b.id AS batch_id,b.title,b.task_type,COALESCE('@'||c.handle,c.wallet_address) AS client,b.client_id,
         sum(t.amount_raw)::text AS amount_raw,max(t.completed_at) AS settled,array_agg(t.tx_hash ORDER BY t.completed_at) AS txs,count(*)::text AS items
       FROM escrow_transfers t JOIN assignments a ON a.id=t.ref_id JOIN batches b ON b.id=a.batch_id JOIN users c ON c.id=b.client_id
       WHERE t.kind='assignment_pay' AND t.status='complete' AND t.recipient_id=$1 GROUP BY b.id,c.handle,c.wallet_address`, [userId]),
    db.query<{ id: string; title: string; client: string; client_id: string; amount_raw: string; settled: Date; tx: string }>(
      `SELECT m.id,g.title||' — '||m.title AS title,COALESCE('@'||c.handle,c.wallet_address) AS client,g.client_id,t.amount_raw::text,t.completed_at AS settled,t.tx_hash AS tx
       FROM escrow_transfers t JOIN milestones m ON m.id=t.ref_id JOIN gigs g ON g.id=m.gig_id JOIN users c ON c.id=g.client_id
       WHERE t.kind='milestone_pay' AND t.status='complete' AND t.recipient_id=$1`, [userId]),
    db.query<{ id: string; title: string; client: string; client_id: string; amount_raw: string; settled: Date; tx: string }>(
      `SELECT p.id,k.title||' — period '||p.number AS title,COALESCE('@'||c.handle,c.wallet_address) AS client,k.client_id,t.amount_raw::text,t.completed_at AS settled,t.tx_hash AS tx
       FROM escrow_transfers t JOIN pay_periods p ON p.id=t.ref_id JOIN contracts k ON k.id=p.contract_id JOIN users c ON c.id=k.client_id
       WHERE t.kind='pay_period' AND t.status='complete' AND t.recipient_id=$1`, [userId]),
  ]);
  const day = (value: Date) => value.toISOString().slice(0, 10);
  return [
    ...jobs.rows.map((r) => ({ kind: "job", ref: r.id, title: r.title, client: r.client, clientId: r.client_id, amountRaw: r.amount_raw, date: day(r.settled), transactions: [r.tx] })),
    ...assignments.rows.map((r) => ({ kind: "quick_tasks", ref: r.batch_id, title: `${r.title} · ${r.items} ${r.task_type} task${r.items === "1" ? "" : "s"}`, client: r.client, clientId: r.client_id, amountRaw: r.amount_raw, date: day(r.settled), transactions: r.txs })),
    ...milestones.rows.map((r) => ({ kind: "milestone", ref: r.id, title: r.title, client: r.client, clientId: r.client_id, amountRaw: r.amount_raw, date: day(r.settled), transactions: [r.tx] })),
    ...periods.rows.map((r) => ({ kind: "pay_run", ref: r.id, title: r.title, client: r.client, clientId: r.client_id, amountRaw: r.amount_raw, date: day(r.settled), transactions: [r.tx] })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

// A salted commitment per entry: a share reveals the salt so anyone can recompute it, while unshared
// entries stay unlinkable to their commitment.
export function historySalt(userId: string, kind: string, ref: string) {
  return createHmac("sha256", config.AUTH_TOKEN_PEPPER).update(`history:${userId}:${kind}:${ref}`).digest("hex").slice(0, 32);
}
export function historyCommitment(entry: Omit<HistoryEntry, "clientId">, salt: string) {
  const canonical = JSON.stringify([entry.kind, entry.ref, entry.title, entry.client, entry.amountRaw, entry.date, [...entry.transactions].sort(), salt]);
  return createHash("sha256").update(canonical).digest("hex");
}

const presentEntry = (userId: string, entry: HistoryEntry, reveal: boolean) => {
  const salt = historySalt(userId, entry.kind, entry.ref);
  const { clientId: _clientId, ...visible } = entry;
  return { ...visible, amount: fromRaw(entry.amountRaw), commitment: historyCommitment(visible, salt), ...(reveal ? { salt } : {}) };
};

accountRouter.get("/history", asyncRoute(async (request, response) => {
  const entries = await workHistory(request.auth!.userId);
  response.json({ data: {
    entries: entries.map((entry) => presentEntry(request.auth!.userId, entry, false)),
    distinctClients: new Set(entries.map((e) => e.clientId)).size,
  } });
}));

accountRouter.get("/history/shares", asyncRoute(async (request, response) => {
  const shares = await db.query<{ id: string; slug: string; title: string; entries: unknown[]; created_at: Date }>(
    "SELECT id,slug,title,entries,created_at FROM history_shares WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC",
    [request.auth!.userId],
  );
  response.json({ data: shares.rows.map((s) => ({ id: s.id, slug: s.slug, title: s.title, entryCount: s.entries.length, createdAt: s.created_at })) });
}));

accountRouter.post("/history/shares", requireWalletSession, asyncRoute(async (request, response) => {
  const input = z.object({
    title: z.string().trim().min(1).max(120),
    entries: z.array(z.object({ kind: z.string(), ref: uuid })).min(1).max(200),
  }).parse(request.body);
  const history = await workHistory(request.auth!.userId);
  const known = new Set(history.map((e) => `${e.kind}:${e.ref}`));
  const unique = [...new Map(input.entries.map((e) => [`${e.kind}:${e.ref}`, e])).values()];
  if (unique.some((e) => !known.has(`${e.kind}:${e.ref}`)))
    throw new ApiError(400, "unknown_history_entry", "Only your own paid work can be shared.");
  const slug = Array.from(randomBytes(12), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const created = await db.query<{ id: string; created_at: Date }>(
    "INSERT INTO history_shares (user_id,slug,title,entries) VALUES ($1,$2,$3,$4) RETURNING id,created_at",
    [request.auth!.userId, slug, input.title, JSON.stringify(unique)],
  );
  response.status(201).json({ data: { id: created.rows[0].id, slug, title: input.title, entryCount: unique.length, createdAt: created.rows[0].created_at } });
}));

accountRouter.delete("/history/shares/:id", requireWalletSession, asyncRoute(async (request, response) => {
  await db.query("UPDATE history_shares SET revoked_at=now() WHERE id=$1 AND user_id=$2", [uuid.parse(request.params.id), request.auth!.userId]);
  response.status(204).end();
}));

export const publicRouter = Router();

publicRouter.get("/history/:slug", asyncRoute(async (request, response) => {
  const slug = z.string().regex(/^[a-z0-9]{12}$/).parse(request.params.slug);
  const share = await db.query<{ user_id: string; title: string; entries: { kind: string; ref: string }[]; created_at: Date; wallet_address: string; handle: string | null }>(
    `SELECT s.user_id,s.title,s.entries,s.created_at,u.wallet_address,u.handle FROM history_shares s JOIN users u ON u.id=s.user_id
     WHERE s.slug=$1 AND s.revoked_at IS NULL`,
    [slug],
  );
  const s = share.rows[0];
  if (!s) throw new ApiError(404, "share_not_found", "This shared history does not exist or was withdrawn.");
  const chosen = new Set(s.entries.map((e) => `${e.kind}:${e.ref}`));
  const entries = (await workHistory(s.user_id)).filter((e) => chosen.has(`${e.kind}:${e.ref}`));
  response.json({ data: {
    title: s.title,
    worker: { handle: s.handle ? `@${s.handle}` : null, wallet: s.wallet_address },
    sharedAt: s.created_at,
    distinctClients: new Set(entries.map((e) => e.clientId)).size,
    total: fromRaw(entries.reduce((sum, e) => sum + BigInt(e.amountRaw), 0n)),
    entries: entries.map((entry) => presentEntry(s.user_id, entry, true)),
    chainId: config.RH_CHAIN_ID,
  } });
}));

publicRouter.get("/handles/:handle", asyncRoute(async (request, response) => {
  const handle = z.string().trim().toLowerCase().transform((v) => v.replace(/^@/, "")).parse(request.params.handle);
  const user = await db.query<{ wallet_address: string; handle: string }>("SELECT wallet_address,handle FROM users WHERE handle=$1", [handle]);
  if (!user.rowCount) throw new ApiError(404, "handle_not_found", `No GigWork account uses @${handle}.`);
  response.json({ data: { handle: `@${user.rows[0].handle}`, wallet: user.rows[0].wallet_address } });
}));

// ---------- Referrals ----------

async function approvedWorkCount(userId: string) {
  const result = await db.query<{ count: string }>(
    `SELECT (
       (SELECT count(*) FROM jobs WHERE doer_id=$1 AND status='completed') +
       (SELECT count(*) FROM assignments WHERE worker_id=$1 AND status='credited') +
       (SELECT count(*) FROM milestones m JOIN gigs g ON g.id=m.gig_id WHERE g.worker_id=$1 AND m.status IN ('approved','split')) +
       (SELECT count(*) FROM pay_periods p JOIN contracts k ON k.id=p.contract_id WHERE k.worker_id=$1 AND p.status='paid')
     )::text AS count`,
    [userId],
  );
  return Number(result.rows[0].count);
}

export function referralEligible(approved: number, referredAt: Date, now = new Date()) {
  return approved >= config.REFERRAL_MIN_APPROVED && now.getTime() - referredAt.getTime() >= config.REFERRAL_MIN_DAYS * 86_400_000;
}

// Create both bonuses once the referee qualifies. Pull-claimed later; nothing is paid automatically.
async function grantIfEligible(refereeId: string, referrerId: string, referredAt: Date) {
  if (!referralEligible(await approvedWorkCount(refereeId), referredAt)) return;
  const amount = toRaw(config.REFERRAL_BONUS_USDG).toString();
  await db.query(
    `INSERT INTO referral_bonuses (referee_id,recipient_id,role,amount_raw) VALUES ($1,$2,'referrer',$4),($1,$3,'referee',$4)
     ON CONFLICT (referee_id,role) DO NOTHING`,
    [refereeId, referrerId, refereeId, amount],
  );
}

async function referralCode(userId: string) {
  const existing = await db.query<{ referral_code: string | null }>("SELECT referral_code FROM users WHERE id=$1", [userId]);
  if (existing.rows[0].referral_code) return existing.rows[0].referral_code;
  for (;;) {
    const code = Array.from(randomBytes(8), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
    try {
      await db.query("UPDATE users SET referral_code=$2 WHERE id=$1 AND referral_code IS NULL", [userId, code]);
      return (await db.query<{ referral_code: string }>("SELECT referral_code FROM users WHERE id=$1", [userId])).rows[0].referral_code;
    } catch (error: any) {
      if (error?.code !== "23505") throw error;
    }
  }
}

async function vaultStatus() {
  const vault = await bonusVault();
  const [balance, pending] = await Promise.all([
    usdgBalance(vault.address).catch(() => null),
    db.query<{ total: string | null }>("SELECT sum(amount_raw)::text AS total FROM escrow_transfers WHERE escrow_id=$1 AND status='pending'", [vault.id]),
  ]);
  const committed = BigInt(pending.rows[0].total ?? "0");
  return { id: vault.id, address: vault.address, balanceRaw: balance, available: balance === null ? null : balance - committed };
}

accountRouter.get("/referrals", asyncRoute(async (request, response) => {
  const userId = request.auth!.userId;
  const me = await db.query<{ referred_by: string | null; referred_at: Date | null }>("SELECT referred_by,referred_at FROM users WHERE id=$1", [userId]);
  if (me.rows[0].referred_by) await grantIfEligible(userId, me.rows[0].referred_by, me.rows[0].referred_at!);
  const invited = await db.query<{ id: string; wallet_address: string; handle: string | null; referred_at: Date }>(
    "SELECT id,wallet_address,handle,referred_at FROM users WHERE referred_by=$1 ORDER BY referred_at", [userId]);
  const invitees = [];
  for (const user of invited.rows) {
    await grantIfEligible(user.id, userId, user.referred_at);
    invitees.push({ who: user.handle ? `@${user.handle}` : `${user.wallet_address.slice(0, 6)}…${user.wallet_address.slice(-4)}`, approved: await approvedWorkCount(user.id), referredAt: user.referred_at });
  }
  const bonuses = await db.query<{ id: string; role: string; amount_raw: string; status: string; created_at: Date; claimed_at: Date | null; tx_hash: string | null; transfer_status: string | null }>(
    `SELECT b.id,b.role,b.amount_raw::text,b.status,b.created_at,b.claimed_at,t.tx_hash,t.status AS transfer_status
     FROM referral_bonuses b LEFT JOIN escrow_transfers t ON t.kind='referral_bonus' AND t.ref_id=b.id
     WHERE b.recipient_id=$1 ORDER BY b.created_at`, [userId]);
  const vault = await vaultStatus();
  response.json({ data: {
    code: await referralCode(userId),
    referred: Boolean(me.rows[0].referred_by),
    myProgress: me.rows[0].referred_by ? { approved: await approvedWorkCount(userId), referredAt: me.rows[0].referred_at } : null,
    invitees,
    bonuses: bonuses.rows.map((b) => ({
      id: b.id, role: b.role, amount: fromRaw(b.amount_raw), status: b.status, createdAt: b.created_at, claimedAt: b.claimed_at,
      payoutStatus: b.transfer_status, transactionHash: b.transfer_status === "complete" ? b.tx_hash : null,
    })),
    program: {
      bonus: config.REFERRAL_BONUS_USDG, minApproved: config.REFERRAL_MIN_APPROVED, minDays: config.REFERRAL_MIN_DAYS,
      maxInvites: config.REFERRAL_MAX_INVITES, budgetAvailable: vault.available === null ? null : fromRaw(vault.available < 0n ? 0n : vault.available),
    },
  } });
}));

accountRouter.post("/referrals/redeem", requireWalletSession, asyncRoute(async (request, response) => {
  const code = z.string().trim().toLowerCase().regex(/^[a-z0-9]{8}$/).parse(request.body?.code);
  await withTransaction(async (client) => {
    const me = await client.query<{ referred_by: string | null; created_at: Date }>("SELECT referred_by,created_at FROM users WHERE id=$1 FOR UPDATE", [request.auth!.userId]);
    if (me.rows[0].referred_by) throw new ApiError(409, "already_referred", "You have already used a referral code.");
    if (Date.now() - me.rows[0].created_at.getTime() > 14 * 86_400_000)
      throw new ApiError(409, "referral_window_closed", "Referral codes can only be used in your first 14 days.");
    const referrer = await client.query<{ id: string }>("SELECT id FROM users WHERE referral_code=$1 FOR UPDATE", [code]);
    if (!referrer.rowCount) throw new ApiError(404, "referral_code_not_found", "That referral code does not exist.");
    if (referrer.rows[0].id === request.auth!.userId) throw new ApiError(400, "self_referral", "You cannot use your own code.");
    const count = await client.query<{ count: string }>("SELECT count(*)::text FROM users WHERE referred_by=$1", [referrer.rows[0].id]);
    if (Number(count.rows[0].count) >= config.REFERRAL_MAX_INVITES)
      throw new ApiError(409, "referrer_limit_reached", "This code has reached its invite limit.");
    await client.query("UPDATE users SET referred_by=$2,referred_at=now() WHERE id=$1", [request.auth!.userId, referrer.rows[0].id]);
  });
  response.json({ data: { referred: true } });
}));

accountRouter.post("/referrals/bonuses/:id/claim", requireWalletSession, asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const vault = await vaultStatus();
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('gigwork:bonus_vault'))");
    const bonus = await client.query<{ status: string; amount_raw: string }>(
      "SELECT status,amount_raw::text FROM referral_bonuses WHERE id=$1 AND recipient_id=$2 FOR UPDATE", [id, request.auth!.userId]);
    if (!bonus.rowCount) throw new ApiError(404, "bonus_not_found", "This bonus does not exist.");
    if (bonus.rows[0].status !== "claimable") throw new ApiError(409, "bonus_claimed", "This bonus was already claimed.");
    const pending = await client.query<{ total: string | null }>(
      "SELECT sum(amount_raw)::text AS total FROM escrow_transfers WHERE escrow_id=$1 AND status='pending'", [vault.id]);
    if (vault.balanceRaw === null || vault.balanceRaw - BigInt(pending.rows[0].total ?? "0") < BigInt(bonus.rows[0].amount_raw))
      throw new ApiError(409, "bonus_budget_exhausted", "The bonus budget is empty right now. Your bonus stays claimable.");
    await client.query("UPDATE referral_bonuses SET status='claimed',claimed_at=now() WHERE id=$1", [id]);
    await createTransfer(client, { escrowId: vault.id, kind: "referral_bonus", refId: id, recipientId: request.auth!.userId, recipient: request.auth!.walletAddress, amountRaw: bonus.rows[0].amount_raw });
  });
  kickEscrow(vault.id);
  response.json({ data: { id, status: "claimed" } });
}));

export const teamAccountRouter = Router();
teamAccountRouter.use(requireAuth, requireTeam);
teamAccountRouter.get("/bonus-vault", asyncRoute(async (_request, response) => {
  const vault = await vaultStatus();
  const paid = await db.query<{ total: string | null; count: string }>(
    "SELECT sum(amount_raw)::text AS total,count(*)::text FROM escrow_transfers WHERE escrow_id=$1 AND status='complete'", [vault.id]);
  response.json({ data: {
    address: vault.address,
    balance: vault.balanceRaw === null ? null : fromRaw(vault.balanceRaw),
    available: vault.available === null ? null : fromRaw(vault.available < 0n ? 0n : vault.available),
    paid: fromRaw(paid.rows[0].total ?? "0"),
    paidCount: Number(paid.rows[0].count),
  } });
}));

// ---------- Tips ----------
// Tips go straight from the client's wallet to the worker's; the server verifies and records the transfer.

async function readUsdgTransfer(hash: Hash, from: string, to: string) {
  let receipt;
  try { receipt = await publicClient.getTransactionReceipt({ hash }); }
  catch { throw new ApiError(409, "tip_not_confirmed", "The tip transaction is not available yet."); }
  if (receipt.status !== "success") throw new ApiError(422, "tip_failed", "The tip transaction reverted.");
  const latest = await publicClient.getBlockNumber();
  if (latest < receipt.blockNumber + BigInt(config.RH_CONFIRMATIONS - 1))
    throw new ApiError(409, "tip_confirmations_pending", "The tip transaction needs more confirmations.");
  const token = config.USDG_TOKEN_ADDRESS.toLowerCase();
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: false, logs: receipt.logs.filter((log) => log.address.toLowerCase() === token) })
    .filter((event) => event.args.from?.toLowerCase() === from.toLowerCase() && event.args.to?.toLowerCase() === to.toLowerCase());
  if (transfers.length !== 1) throw new ApiError(422, "tip_transfer_mismatch", "Send the tip in USDG from your signed-in wallet to the worker's wallet.");
  return transfers[0].args.value!;
}

async function tipSubject(kind: string, id: string) {
  const queries: Record<string, string> = {
    job: `SELECT j.client_id,j.doer_id AS worker_id,w.wallet_address AS worker_wallet,j.amount_raw::text AS pay_raw,j.status='completed' AS credited
          FROM jobs j JOIN users w ON w.id=j.doer_id WHERE j.id=$1`,
    assignment: `SELECT b.client_id,a.worker_id,w.wallet_address AS worker_wallet,b.pay_raw::text AS pay_raw,a.status='credited' AS credited
          FROM assignments a JOIN batches b ON b.id=a.batch_id JOIN users w ON w.id=a.worker_id WHERE a.id=$1`,
    milestone: `SELECT g.client_id,g.worker_id,w.wallet_address AS worker_wallet,m.amount_raw::text AS pay_raw,m.status IN ('approved','split') AS credited
          FROM milestones m JOIN gigs g ON g.id=m.gig_id JOIN users w ON w.id=g.worker_id WHERE m.id=$1`,
    pay_period: `SELECT k.client_id,k.worker_id,w.wallet_address AS worker_wallet,p.amount_raw::text AS pay_raw,p.status='paid' AS credited
          FROM pay_periods p JOIN contracts k ON k.id=p.contract_id JOIN users w ON w.id=k.worker_id WHERE p.id=$1`,
  };
  const result = await db.query<{ client_id: string; worker_id: string; worker_wallet: string; pay_raw: string; credited: boolean }>(queries[kind], [id]);
  if (!result.rowCount) throw new ApiError(404, "tip_subject_not_found", "That work does not exist.");
  return result.rows[0];
}

accountRouter.get("/tips/quote", asyncRoute(async (request, response) => {
  const kind = z.enum(["job", "assignment", "milestone", "pay_period"]).parse(request.query.subjectKind);
  const id = uuid.parse(request.query.subjectId);
  const subject = await tipSubject(kind, id);
  if (subject.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can tip this work.");
  const tipped = await db.query<{ total: string | null }>("SELECT sum(amount_raw)::text AS total FROM tips WHERE subject_kind=$1 AND subject_id=$2", [kind, id]);
  const remaining = BigInt(subject.pay_raw) - BigInt(tipped.rows[0].total ?? "0");
  response.json({ data: {
    credited: subject.credited, workerWallet: subject.worker_wallet, maxTip: fromRaw(remaining < 0n ? 0n : remaining),
    tokenAddress: config.USDG_TOKEN_ADDRESS.toLowerCase(),
  } });
}));

accountRouter.post("/tips", asyncRoute(async (request, response) => {
  const input = z.object({
    subjectKind: z.enum(["job", "assignment", "milestone", "pay_period"]),
    subjectId: uuid,
    transactionHash: z.string(),
    message: z.string().trim().max(280).optional(),
  }).parse(request.body);
  const hash = parseHash(input.transactionHash);
  const subject = await tipSubject(input.subjectKind, input.subjectId);
  if (subject.client_id !== request.auth!.userId) throw new ApiError(403, "client_only", "Only the client can tip this work.");
  if (!subject.credited) throw new ApiError(409, "work_not_credited", "Tips are only for work that has been approved and credited.");
  const amount = await readUsdgTransfer(hash, request.auth!.walletAddress, subject.worker_wallet);
  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tip:${input.subjectId}`]);
    const tipped = await client.query<{ total: string | null }>("SELECT sum(amount_raw)::text AS total FROM tips WHERE subject_kind=$1 AND subject_id=$2", [input.subjectKind, input.subjectId]);
    if (BigInt(tipped.rows[0].total ?? "0") + amount > BigInt(subject.pay_raw))
      throw new ApiError(422, "tip_too_large", "Tips on one piece of work can total at most 100% of its pay.");
    try {
      await client.query(
        "INSERT INTO tips (from_id,to_id,subject_kind,subject_id,amount_raw,tx_hash,message) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [request.auth!.userId, subject.worker_id, input.subjectKind, input.subjectId, amount.toString(), hash, input.message ?? null],
      );
    } catch (error: any) {
      if (error?.code === "23505") throw new ApiError(409, "tip_already_recorded", "This tip transaction was already recorded.");
      throw error;
    }
  });
  response.status(201).json({ data: { amount: fromRaw(amount), transactionHash: hash } });
}));
