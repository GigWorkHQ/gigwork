import { randomBytes, randomInt } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { hashSessionToken, requireAuth, requireBrowserWallet } from "./auth.js";
import { uuid, withTransaction } from "./common.js";
import { db } from "./db/index.js";
import { ApiError, asyncRoute } from "./http.js";

// Pairing the Android companion app to a web account.
//
// The web, signed in with the wallet, asks for a code. The phone sends the code back here and receives a device session
// for the same account. Codes are 8 characters from a 31-letter alphabet (about 8.5e11 combinations), single use, live
// 10 minutes, and are stored only as a peppered hash; redeeming sits behind the sign-in rate limit.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_LENGTH = 8;
const CODE_MINUTES = 10;
const DEVICE_SESSION_DAYS = 90;
const MAX_DEVICES = 10;

export function newPairingCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** "abcd-2345", "ABCD 2345" and "abcd2345" are the same code. Anything else is not a code. */
export function normalizePairingCode(input: string) {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH || [...code].some((c) => !ALPHABET.includes(c))) return null;
  return code;
}

export const displayPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
const codeHash = (code: string) => hashSessionToken(`pairing:${code}`);

// ---------- web side: create a code, list and remove paired phones ----------

export const pairingRouter = Router();
pairingRouter.use(requireAuth);

pairingRouter.post("/pairing/codes", requireBrowserWallet, asyncRoute(async (request, response) => {
  const userId = request.auth!.userId;
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
  await withTransaction(async (client) => {
    // One live code at a time: asking again replaces the previous one.
    await client.query("DELETE FROM pairing_codes WHERE user_id=$1 AND consumed_at IS NULL", [userId]);
    await client.query("INSERT INTO pairing_codes (code_hash,user_id,expires_at) VALUES ($1,$2,$3)", [codeHash(code), userId, expiresAt]);
  });
  response.status(201).json({ data: { code: displayPairingCode(code), expiresAt } });
}));

pairingRouter.get("/devices", asyncRoute(async (request, response) => {
  const rows = await db.query<{ id: string; device_name: string; created_at: Date; last_used_at: Date | null; expires_at: Date }>(
    `SELECT id,device_name,created_at,last_used_at,expires_at FROM sessions
     WHERE user_id=$1 AND kind='device' AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
    [request.auth!.userId],
  );
  response.json({ data: rows.rows.map((r) => ({
    id: r.id, name: r.device_name, pairedAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at,
    thisDevice: r.id === request.auth!.sessionId,
  })) });
}));

pairingRouter.delete("/devices/:id", asyncRoute(async (request, response) => {
  const id = uuid.parse(request.params.id);
  // A phone may unpair itself; removing other phones is done from the web.
  if (request.auth!.viaDevice && id !== request.auth!.sessionId)
    throw new ApiError(403, "browser_wallet_required", "Remove other phones from the web, signed in with your wallet.");
  const revoked = await db.query(
    "UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND kind='device' AND revoked_at IS NULL", [id, request.auth!.userId]);
  if (!revoked.rowCount) throw new ApiError(404, "device_not_found", "This phone is not paired.");
  response.status(204).end();
}));

// ---------- phone side: redeem a code (mounted under /v1/auth, so it shares the sign-in rate limit) ----------

export async function redeemPairingCode(input: { code: string; deviceName: string }) {
  const code = normalizePairingCode(input.code);
  if (!code) throw new ApiError(400, "invalid_pairing_code", "Enter the 8-character code shown on the web.");
  return withTransaction(async (client) => {
    const found = await client.query<{ user_id: string; expires_at: Date; consumed_at: Date | null }>(
      "SELECT user_id,expires_at,consumed_at FROM pairing_codes WHERE code_hash=$1 FOR UPDATE", [codeHash(code)]);
    const row = found.rows[0];
    // One answer for unknown, used and expired codes, so a guess learns nothing.
    if (!row || row.consumed_at || row.expires_at <= new Date())
      throw new ApiError(401, "pairing_code_invalid", "That code is wrong or has expired. Make a new one on the web.");
    const devices = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM sessions WHERE user_id=$1 AND kind='device' AND revoked_at IS NULL AND expires_at>now()", [row.user_id]);
    if (Number(devices.rows[0].count) >= MAX_DEVICES)
      throw new ApiError(409, "too_many_devices", `This account already has ${MAX_DEVICES} paired phones. Remove one on the web first.`);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + DEVICE_SESSION_DAYS * 86_400_000);
    const session = await client.query<{ id: string }>(
      "INSERT INTO sessions (token_hash,user_id,expires_at,kind,device_name) VALUES ($1,$2,$3,'device',$4) RETURNING id",
      [hashSessionToken(token), row.user_id, expiresAt, input.deviceName]);
    await client.query("UPDATE pairing_codes SET consumed_at=now(),session_id=$2 WHERE code_hash=$1", [codeHash(code), session.rows[0].id]);
    const user = await client.query<{ wallet_address: string; handle: string | null }>("SELECT wallet_address,handle FROM users WHERE id=$1", [row.user_id]);
    return {
      token, expiresAt, sessionId: session.rows[0].id,
      walletAddress: user.rows[0].wallet_address, handle: user.rows[0].handle ? `@${user.rows[0].handle}` : null,
    };
  });
}

export const pairInput = z.object({
  code: z.string().trim().min(1).max(20),
  deviceName: z.string().trim().min(1).max(60).default("Android phone"),
});

// Keeper step: drop codes that expired over a day ago.
export async function sweepPairingCodes() {
  await db.query("DELETE FROM pairing_codes WHERE expires_at < now() - interval '1 day'");
}
