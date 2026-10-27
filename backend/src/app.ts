import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { createSession, issueNonce, requireAuth, requireWalletSession, revokeSession } from "./auth.js";
import { allowedOrigins, config } from "./config.js";
import { corsMiddleware } from "./cors.js";
import { chain } from "./escrow.js";
import { db } from "./db/index.js";
import { jobsRouter, teamJobsRouter } from "./jobs.js";
import { ApiError, asyncRoute, errorHandler } from "./http.js";
import { runKeeper } from "./keeper.js";
import { accountRouter, publicRouter, teamAccountRouter } from "./account.js";
import { batchesRouter, tasksRouter } from "./batches.js";
import { contractsRouter } from "./contracts.js";
import { gigsRouter } from "./gigs.js";
import { reviewsRouter, teamReviewsRouter } from "./reviews.js";

const app = express();
app.set("trust proxy", config.TRUST_PROXY);
app.use(corsMiddleware(allowedOrigins));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_request, response) =>
  response.json({ service: "gigwork-api", status: "ok", commit: process.env.GIT_SHA ?? "unknown" }),
);
app.get("/health/ready", asyncRoute(async (_request, response) => {
  await db.query("SELECT 1");
  response.json({ status: "ready" });
}));

app.get("/v1/config", (_request, response) =>
  response.json({
    data: {
      chainId: chain.id,
      chainName: chain.name,
      explorerUrl: chain.blockExplorers.default.url,
      rpcUrl: config.PUBLIC_RPC_URL ?? (chain.id === 4663 ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com"),
      usdg: { address: config.USDG_TOKEN_ADDRESS.toLowerCase(), decimals: config.USDG_DECIMALS },
      confirmations: config.RH_CONFIRMATIONS,
      rules: {
        jobReviewHours: config.JOB_REVIEW_HOURS,
        taskReviewHoursMin: 24,
        gigReviewHoursMin: 72,
        disputeWindowHours: config.DISPUTE_WINDOW_HOURS,
        reviewerDrawDelayMinutes: config.REVIEW_DRAW_DELAY_MINUTES,
        reviewerDeadlineHours: config.REVIEW_DEADLINE_HOURS,
        hourlyFloorUsdg: "6",
      },
    },
  }),
);

const authRouter = Router();
authRouter.post("/nonce", asyncRoute(async (request, response) => {
  const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).parse(request.body?.address);
  response.json({ data: await issueNonce(address, request.header("origin")) });
}));
authRouter.post("/verify", asyncRoute(async (request, response) => {
  const input = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), nonce: z.string().min(1), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }).parse(request.body);
  response.json({ data: await createSession({ ...input, signature: input.signature as `0x${string}` }) });
}));
authRouter.post("/logout", requireAuth, requireWalletSession, asyncRoute(async (request, response) => {
  await revokeSession(request);
  response.status(204).end();
}));
authRouter.get("/me", requireAuth, (request, response) => response.json({ data: request.auth }));

const cronRouter = Router();
cronRouter.post("/settle", asyncRoute(async (request, response) => {
  const supplied = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(config.CRON_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "cron_unauthorized", "A valid cron bearer token is required.");
  void runKeeper().catch((error) => console.error("Keeper run failed:", error));
  response.status(202).json({ data: { status: "reconciliation_started" } });
}));

app.use("/v1/auth", authRouter);
app.use("/v1/jobs", jobsRouter);
app.use("/v1/team", teamJobsRouter);
app.use("/v1/team", teamReviewsRouter);
app.use("/v1/team", teamAccountRouter);
app.use("/v1/batches", batchesRouter);
app.use("/v1/tasks", tasksRouter);
app.use("/v1/gigs", gigsRouter);
app.use("/v1/contracts", contractsRouter);
app.use("/v1/reviews", reviewsRouter);
app.use("/v1/public", publicRouter);
app.use("/v1", accountRouter);
app.use("/v1/cron", cronRouter);
app.use((_request, _response, next) => next(new ApiError(404, "not_found", "This endpoint does not exist.")));
app.use(errorHandler);

export { app };
