import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createSiweMessage } from "viem/siwe";
import { verifyMessage } from "viem";
import { db } from "./db/index.js";
import { allowedOrigins, config, teamWallets } from "./config.js";
import { ApiError } from "./http.js";

const SESSION_DAYS = 7;
export const API_KEY_PREFIX = "gwk_";
const canonical = (address: string) => address.toLowerCase();
export const hashSessionToken = (token: string) =>
  createHash("sha256").update(`${config.AUTH_TOKEN_PEPPER}:${token}`).digest("hex");

export function extractBearerToken(authorization: string | undefined) {
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
}

// The message names the frontend the user is on when it is an allowed origin, else the configured site.
export function signInSite(origin: string | undefined, allowed: ReadonlySet<string> = allowedOrigins) {
  if (origin && allowed.has(origin)) return { domain: new URL(origin).host, uri: origin };
  return { domain: config.AUTH_DOMAIN, uri: config.AUTH_URI };
}

export function signInMessage(address: string, nonce: string, issuedAt: Date, expiresAt: Date, site = signInSite(undefined)) {
  return createSiweMessage({
    domain: site.domain,
    address: address as `0x${string}`,
    statement: "Sign in to GigWork.",
    uri: site.uri,
    version: "1",
    chainId: config.RH_CHAIN_ID,
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  });
}

export async function issueNonce(address: string, origin?: string) {
  const site = signInSite(origin);
  const walletAddress = canonical(address);
  const nonce = randomBytes(24).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
  await db.query(
    "INSERT INTO auth_nonces (nonce, wallet_address, issued_at, expires_at, domain, uri) VALUES ($1,$2,$3,$4,$5,$6)",
    [nonce, walletAddress, issuedAt, expiresAt, site.domain, site.uri],
  );
  return {
    walletAddress,
    nonce,
    message: signInMessage(walletAddress, nonce, issuedAt, expiresAt, site),
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
    const nonce = await client.query<{ issued_at: Date; expires_at: Date; domain: string | null; uri: string | null }>(
      "SELECT issued_at, expires_at, domain, uri FROM auth_nonces WHERE wallet_address=$1 AND nonce=$2 AND consumed_at IS NULL FOR UPDATE",
      [walletAddress, input.nonce],
    );
    const challenge = nonce.rows[0];
    if (!challenge || challenge.expires_at <= new Date())
      throw new ApiError(401, "invalid_nonce", "This sign-in request expired. Request a new nonce.");
    const valid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message: signInMessage(walletAddress, input.nonce, challenge.issued_at, challenge.expires_at,
        challenge.domain && challenge.uri ? { domain: challenge.domain, uri: challenge.uri } : signInSite(undefined)),
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
      auth?: { userId: string; walletAddress: string; viaApiKey?: boolean };
    }
  }
}

export async function requireAuth(request: Request, _response: Response, next: NextFunction) {
  try {
    const bearer = extractBearerToken(request.header("authorization"));
    if (!bearer) throw new ApiError(401, "unauthenticated", "A bearer session token is required.");
    if (bearer.startsWith(API_KEY_PREFIX)) {
      const key = await db.query<{ user_id: string; wallet_address: string }>(
        `UPDATE api_keys k SET last_used_at=now() FROM users u
         WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND u.id=k.user_id RETURNING k.user_id,u.wallet_address`,
        [hashSessionToken(bearer)],
      );
      if (!key.rowCount) throw new ApiError(401, "invalid_api_key", "This API key is invalid or revoked.");
      request.auth = { userId: key.rows[0].user_id, walletAddress: key.rows[0].wallet_address, viaApiKey: true };
      next();
      return;
    }
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

// Agent API keys act for their owner but cannot manage keys or sign out wallet sessions.
export function requireWalletSession(request: Request, _response: Response, next: NextFunction) {
  if (request.auth?.viaApiKey) {
    next(new ApiError(403, "wallet_session_required", "Sign in with your wallet to do this; API keys cannot."));
    return;
  }
  next();
}

export async function createApiKey(userId: string, label: string) {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const result = await db.query<{ id: string; created_at: Date }>(
    "INSERT INTO api_keys (user_id,label,prefix,key_hash) VALUES ($1,$2,$3,$4) RETURNING id,created_at",
    [userId, label, key.slice(0, 10), hashSessionToken(key)],
  );
  return { id: result.rows[0].id, label, prefix: key.slice(0, 10), key, createdAt: result.rows[0].created_at };
}
