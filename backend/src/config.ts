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
    // Public RPC handed to wallets for adding the network. Never the private RH_RPC_URL.
    PUBLIC_RPC_URL: z.string().url().optional(),
    CORS_ORIGINS: z.string().default(""),
    AUTH_TOKEN_PEPPER: z.string().min(32),
    DATA_ENCRYPTION_KEY: z.string().min(32),
    TEAM_WALLET_ADDRESSES: z.string().default(""),
    GAS_WALLET_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    CRON_SECRET: z.string().min(32),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
    JOB_REVIEW_HOURS: z.coerce.number().int().min(24).max(336).default(72),
    REVIEW_DRAW_DELAY_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
    REVIEW_DEADLINE_HOURS: z.coerce.number().int().min(1).max(336).default(72),
    DISPUTE_WINDOW_HOURS: z.coerce.number().int().min(1).max(336).default(72),
    REFERRAL_BONUS_USDG: z.string().regex(/^\d+(\.\d+)?$/).default("3"),
    REFERRAL_MAX_INVITES: z.coerce.number().int().min(0).max(100).default(5),
    REFERRAL_MIN_APPROVED: z.coerce.number().int().min(1).max(1000).default(10),
    REFERRAL_MIN_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    // Comma list of SYMBOL:0xaddress stock tokens workers may elect. Empty keeps payouts USDG-only.
    STOCK_TOKENS: z.string().default(""),
    STOCK_EXCLUDED_COUNTRIES: z.string().default("US,GB,CA,CH"),
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
export const stockTokens = env.STOCK_TOKENS.split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [symbol, address] = entry.split(":");
    if (!/^[A-Z0-9.]{1,12}$/.test(symbol ?? "") || !/^0x[0-9a-fA-F]{40}$/.test(address ?? ""))
      throw new Error(`Invalid STOCK_TOKENS entry: ${entry}`);
    return { symbol, address: address.toLowerCase() };
  });
export const stockExcludedCountries = new Set(
  env.STOCK_EXCLUDED_COUNTRIES.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean),
);
