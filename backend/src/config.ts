import "dotenv/config";
import { z } from "zod";
import { parseAllowedOrigins } from "./cors.js";

const env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().url(),
    RH_CHAIN_ID: z.coerce.number().int().refine((value) => [4663, 46630].includes(value)),
    RH_RPC_URL: z.string().url(),
    USDG_TOKEN_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    USDG_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),
    RH_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(2),
    AUTH_DOMAIN: z.string().min(1).default("localhost"),
    AUTH_URI: z.string().url().default("http://localhost:4174"),
    CORS_ORIGINS: z.string().default(""),
    AUTH_TOKEN_PEPPER: z.string().min(32),
    DATA_ENCRYPTION_KEY: z.string().min(32),
    TEAM_WALLET_ADDRESSES: z.string().default(""),
    GAS_WALLET_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    CRON_SECRET: z.string().min(32),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  })
  .parse(process.env);

if (env.DATA_ENCRYPTION_KEY === env.AUTH_TOKEN_PEPPER) {
  throw new Error("DATA_ENCRYPTION_KEY must differ from AUTH_TOKEN_PEPPER.");
}

export const config = env;
export const allowedOrigins = parseAllowedOrigins(env.CORS_ORIGINS, env.AUTH_URI);
export const teamWallets = new Set(
  env.TEAM_WALLET_ADDRESSES.split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean),
);
