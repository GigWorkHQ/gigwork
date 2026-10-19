import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createSiweMessage } from "viem/siwe";
import { verifyMessage } from "viem";
import { db } from "./db/index.js";
import { config, teamWallets } from "./config.js";
import { ApiError } from "./http.js";

const SESSION_DAYS = 7;
const canonical = (address: string) => address.toLowerCase();
export const hashSessionToken = (token: string) =>
  createHash("sha256").update(`${config.AUTH_TOKEN_PEPPER}:${token}`).digest("hex");

export function extractBearerToken(authorization: string | undefined) {
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
}

export function signInMessage(address: string, nonce: string, issuedAt: Date, expiresAt: Date) {
  return createSiweMessage({
    domain: config.AUTH_DOMAIN,
    address: address as `0x${string}`,
    statement: "Sign in to GigWork.",
    uri: config.AUTH_URI,
    version: "1",
    chainId: config.RH_CHAIN_ID,
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  });
}

export async function issueNonce(address: string) {
  const walletAddress = canonical(address);
  const nonce = randomBytes(24).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
  await db.query(
    "INSERT INTO auth_nonces (nonce, wallet_address, issued_at, expires_at) VALUES ($1,$2,$3,$4)",
    [nonce, walletAddress, issuedAt, expiresAt],
  );
  return {
    walletAddress,
    nonce,
    message: signInMessage(walletAddress, nonce, issuedAt, expiresAt),
    expiresAt,
  };
}

export async function createSession(input: {
  address: string;
  nonce: string;
  signature: `0x${string}`;
}) {
  const walletAddress = canonical(input.address);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const nonce = await client.query<{ issued_at: Date; expires_at: Date }>(
      "SELECT issued_at, expires_at FROM auth_nonces WHERE wallet_address=$1 AND nonce=$2 AND consumed_at IS NULL FOR UPDATE",
      [walletAddress, input.nonce],
    );
    const challenge = nonce.rows[0];
    if (!challenge || challenge.expires_at <= new Date())
      throw new ApiError(401, "invalid_nonce", "This sign-in request expired. Request a new nonce.");
    const valid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message: signInMessage(walletAddress, input.nonce, challenge.issued_at, challenge.expires_at),
      signature: input.signature,
    });
    if (!valid) throw new ApiError(401, "invalid_signature", "The signature does not match this wallet.");

    await client.query("UPDATE auth_nonces SET consumed_at=now() WHERE nonce=$1", [input.nonce]);
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (wallet_address) VALUES ($1)
       ON CONFLICT (wallet_address) DO UPDATE SET updated_at=now() RETURNING id`,
      [walletAddress],
    );
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await client.query("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)", [
      hashSessionToken(token),
      user.rows[0].id,
      expiresAt,
    ]);
    await client.query("COMMIT");
    return { token, expiresAt, userId: user.rows[0].id, walletAddress };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; walletAddress: string };
    }
  }
}

export async function requireAuth(request: Request, _response: Response, next: NextFunction) {
  try {
    const bearer = extractBearerToken(request.header("authorization"));
    if (!bearer) throw new ApiError(401, "unauthenticated", "A bearer session token is required.");
    const result = await db.query<{ user_id: string; wallet_address: string }>(
      `SELECT s.user_id,u.wallet_address FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [hashSessionToken(bearer)],
    );
    if (!result.rowCount) throw new ApiError(401, "invalid_session", "This session is invalid or expired.");
    request.auth = { userId: result.rows[0].user_id, walletAddress: result.rows[0].wallet_address };
    next();
  } catch (error) {
    next(error);
  }
}

export function isTeamWallet(address: string, authorizedWallets: ReadonlySet<string> = teamWallets) {
  return authorizedWallets.has(address.toLowerCase());
}

export function requireTeam(request: Request, _response: Response, next: NextFunction) {
  if (!request.auth || !isTeamWallet(request.auth.walletAddress)) {
    next(new ApiError(403, "team_only", "Only an authorized GigWork team wallet can perform this action."));
    return;
  }
  next();
}

export async function revokeSession(request: Request) {
  const bearer = extractBearerToken(request.header("authorization"));
  if (bearer) await db.query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", [hashSessionToken(bearer)]);
}
