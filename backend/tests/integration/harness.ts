// Real-Postgres route tests. They run the actual Express app against a fresh schema built by the real migrations.
// Chain reads are stubbed on the shared viem client, so every database rule, lock and route guard runs for real.
// Enable with DB_TESTS=1 and a DATABASE_URL pointing at a disposable database (CI starts a Postgres 16 service).
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { spyOn } from "bun:test";
import { encodeAbiParameters, keccak256, pad, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const enabled = process.env.DB_TESTS === "1";

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db/index.js");
const { migrate } = await import("../../src/db/migrate.js");
const { hashSessionToken } = await import("../../src/auth.js");
const { publicClient } = await import("../../src/escrow.js");
const { config } = await import("../../src/config.js");
export { db, config };

export const TOKEN = config.USDG_TOKEN_ADDRESS.toLowerCase() as Address;
export const TEAM_WALLET = "0x2222222222222222222222222222222222222222";
export const usdg = (amount: number) => BigInt(Math.round(amount * 1_000_000));

let server: Server | undefined;
let base = "";

export async function startApp() {
  await db.query("DROP SCHEMA public CASCADE");
  await db.query("CREATE SCHEMA public");
  await migrate();
  server = app.listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  stubChain();
}

export async function stopApp() {
  await new Promise((resolve) => server?.close(resolve));
  // Background payout attempts fail fast against the stubbed chain; give them a moment before closing the pool.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// ---------- chain stubs ----------

export const chain = {
  balances: new Map<string, bigint>(),
  transactions: new Map<string, { from: string; to: string; amount: bigint }>(),
  block: 1_000n,
};

function stubChain() {
  // Payouts kicked in the background fail against the offline chain stub by design; keep their logs out of the output.
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^(Escrow|Settlement) .* (payout failed|failed to start)/.test(args[0])) return;
    original(...args);
  };
  spyOn(publicClient, "readContract").mockImplementation((async (args: any) => {
    if (args.functionName === "balanceOf") return chain.balances.get(String(args.args[0]).toLowerCase()) ?? 0n;
    throw new Error(`unstubbed readContract ${args.functionName}`);
  }) as any);
  spyOn(publicClient, "getBlockNumber").mockImplementation((async () => chain.block) as any);
  spyOn(publicClient, "getGasPrice").mockImplementation((async () => { throw new Error("chain offline in tests"); }) as any);
  spyOn(publicClient, "getBalance").mockImplementation((async () => 0n) as any);
  spyOn(publicClient, "getTransaction").mockImplementation((async ({ hash }: { hash: string }) => {
    const tx = chain.transactions.get(hash);
    if (!tx) throw Object.assign(new Error("not found"), { name: "TransactionNotFoundError" });
    return { chainId: config.RH_CHAIN_ID, from: tx.from, to: TOKEN, value: 0n, input: "0x" };
  }) as any);
  spyOn(publicClient, "getTransactionReceipt").mockImplementation((async ({ hash }: { hash: string }) => {
    const tx = chain.transactions.get(hash);
    if (!tx) throw Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
    return {
      status: "success",
      blockNumber: chain.block - 10n,
      logs: [{
        address: TOKEN,
        topics: [keccak256(toHex("Transfer(address,address,uint256)")), pad(tx.from as Address), pad(tx.to as Address)],
        data: encodeAbiParameters([{ type: "uint256" }], [tx.amount]),
        blockNumber: chain.block - 10n, transactionHash: hash, logIndex: 0, transactionIndex: 0, blockHash: `0x${"ab".repeat(32)}`, removed: false,
      }],
    };
  }) as any);
}

// A confirmed USDG transfer on the stubbed chain. Moves the balance too, unless told not to.
export function sendUsdg(from: string, to: string, amount: bigint, options: { moveBalance?: boolean } = {}) {
  const hash = `0x${randomBytes(32).toString("hex")}`;
  chain.transactions.set(hash, { from: from.toLowerCase(), to: to.toLowerCase(), amount });
  if (options.moveBalance !== false) chain.balances.set(to.toLowerCase(), (chain.balances.get(to.toLowerCase()) ?? 0n) + amount);
  return hash;
}

// ---------- users and sessions ----------

export type User = { id: string; wallet: string; token: string };

// A wallet session inserted directly (the SIWE flow itself is covered in auth.route.test.ts).
export async function sessionFor(wallet: string): Promise<User> {
  const address = wallet.toLowerCase();
  const user = await db.query<{ id: string }>(
    "INSERT INTO users (wallet_address) VALUES ($1) ON CONFLICT (wallet_address) DO UPDATE SET updated_at=now() RETURNING id", [address]);
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 day')", [hashSessionToken(token), user.rows[0].id]);
  return { id: user.rows[0].id, wallet: address, token };
}

export async function newUser() {
  return sessionFor(privateKeyToAccount(generatePrivateKey()).address);
}

export async function teamUser() {
  return sessionFor(TEAM_WALLET);
}

// ---------- HTTP ----------

export async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export async function createBatch(client: User, overrides: Record<string, unknown> = {}) {
  const created = await call("POST", "/v1/batches", client.token, {
    title: "Pick the better headline",
    instructions: "Choose the headline that reads more clearly to a first-time visitor.",
    taskType: "judge", pay: "0.2", minutes: 1, items: [{ prompt: "A or B?", options: ["A", "B"] }, { prompt: "C or D?", options: ["C", "D"] }],
    ...overrides,
  });
  if (created.status !== 201) throw new Error(`batch create failed: ${JSON.stringify(created.body)}`);
  return created.body.data;
}

export async function createJob(client: User, amount = "1") {
  const created = await call("POST", "/v1/jobs", client.token, {
    title: "Write a product blurb", description: "Two sentences about the morning newsletter.",
    acceptanceCriteria: ["Under 50 words"], asset: "usdg", amount,
  });
  if (created.status !== 201) throw new Error(`job create failed: ${JSON.stringify(created.body)}`);
  return created.body.data;
}
