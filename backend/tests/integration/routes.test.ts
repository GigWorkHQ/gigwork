import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  call, chain, config, createBatch, createJob, db, enabled, newUser, sendUsdg, startApp, stopApp, teamUser, usdg, type User,
} from "./harness.js";

describe.skipIf(!enabled)("routes against real Postgres", () => {
  beforeAll(startApp);
  afterAll(stopApp);

  // ---------- auth ----------

  describe("sign-in", () => {
    test("a SIWE signature opens a session and its nonce cannot be replayed", async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const nonce = await call("POST", "/v1/auth/nonce", undefined, { address: account.address });
      expect(nonce.status).toBe(200);
      const signature = await account.signMessage({ message: nonce.body.data.message });
      const verify = await call("POST", "/v1/auth/verify", undefined, { address: account.address, nonce: nonce.body.data.nonce, signature });
      expect(verify.status).toBe(200);
      const me = await call("GET", "/v1/auth/me", verify.body.data.token);
      expect(me.body.data.walletAddress).toBe(account.address.toLowerCase());
      const replay = await call("POST", "/v1/auth/verify", undefined, { address: account.address, nonce: nonce.body.data.nonce, signature });
      expect(replay.status).toBeGreaterThanOrEqual(400);
    });

    test("a signature from another wallet is refused", async () => {
      const victim = privateKeyToAccount(generatePrivateKey());
      const attacker = privateKeyToAccount(generatePrivateKey());
      const nonce = await call("POST", "/v1/auth/nonce", undefined, { address: victim.address });
      const signature = await attacker.signMessage({ message: nonce.body.data.message });
      const verify = await call("POST", "/v1/auth/verify", undefined, { address: victim.address, nonce: nonce.body.data.nonce, signature });
      expect(verify.status).toBe(401);
    });

    test("protected routes need a bearer token", async () => {
      for (const path of ["/v1/jobs/mine", "/v1/batches/mine", "/v1/recoverable", "/v1/team/reviews", "/v1/referrals"])
        expect((await call("GET", path)).status).toBe(401);
    });
  });

  // ---------- ownership ----------

  describe("ownership", () => {
    let owner: User;
    let stranger: User;
    beforeAll(async () => { owner = await newUser(); stranger = await newUser(); });

    test("only the client can cancel or fund a job", async () => {
      const job = await createJob(owner);
      expect((await call("POST", `/v1/jobs/${job.id}/cancel`, stranger.token)).status).toBe(403);
      expect((await call("POST", `/v1/jobs/${job.id}/fund`, stranger.token, { transactionHash: `0x${"1".repeat(64)}` })).status).toBe(403);
    });

    test("an unfunded batch is invisible to others and only its client can close it", async () => {
      const batch = await createBatch(owner);
      expect((await call("GET", `/v1/batches/${batch.id}`, stranger.token)).status).toBe(404);
      expect((await call("POST", `/v1/batches/${batch.id}/close`, stranger.token)).status).toBeGreaterThanOrEqual(403);
    });

    test("only the client can recover an escrow", async () => {
      const batch = await createBatch(owner);
      const escrow = (await db.query("SELECT escrow_id FROM batches WHERE id=$1", [batch.id])).rows[0].escrow_id;
      expect((await call("POST", `/v1/escrows/${escrow}/recover`, stranger.token)).status).toBe(404);
    });
  });

  // ---------- team powers (L-1) ----------

  describe("team routes", () => {
    test("a team wallet session works, its API key and other wallets do not", async () => {
      const team = await teamUser();
      expect((await call("GET", "/v1/team/reviewers", team.token)).status).toBe(200);
      const key = await call("POST", "/v1/me/api-keys", team.token, { label: "ci" });
      expect(key.status).toBe(201);
      const viaKey = await call("GET", "/v1/team/reviewers", key.body.data.key);
      expect(viaKey.status).toBe(403);
      expect(viaKey.body.error.code).toBe("wallet_session_required");
      const outsider = await newUser();
      expect((await call("GET", "/v1/team/reviewers", outsider.token)).status).toBe(403);
    });

    test("reviewer changes are written to the team action log", async () => {
      const team = await teamUser();
      const reviewer = await newUser();
      expect((await call("POST", "/v1/team/reviewers", team.token, { user: reviewer.wallet })).status).toBe(201);
      expect((await call("POST", `/v1/team/reviewers/${reviewer.id}/deactivate`, team.token)).status).toBe(200);
      const log = await call("GET", "/v1/team/actions", team.token);
      const actions = log.body.data.filter((a: any) => a.subjectId === reviewer.id).map((a: any) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["reviewer.add", "reviewer.deactivate"]));
    });
  });

  // ---------- amounts and limits (L-3) ----------

  describe("listing limits", () => {
    test("amounts below the minimum are refused everywhere", async () => {
      const client = await newUser();
      const job = await call("POST", "/v1/jobs", client.token, {
        title: "Dust job", description: "x", acceptanceCriteria: ["x"], asset: "usdg", amount: "0.000001",
      });
      expect(job.status).toBe(400);
      expect(job.body.error.code).toBe("amount_below_minimum");
      const gig = await call("POST", "/v1/gigs", client.token, {
        title: "Dust gig", description: "A gig with a dust milestone.", category: "writing", reviewHours: 72,
        milestones: [{ title: "One", description: "x", amount: "0.01" }],
      });
      expect(gig.status).toBe(400);
    });

    test("a client can post at most DAILY_CREATE_LIMIT items a day", async () => {
      const client = await newUser();
      await db.query(
        `INSERT INTO jobs (client_id,title,description,acceptance_criteria,asset,amount_raw,token_address)
         SELECT $1,'Seeded job','x','["x"]','usdg',1000000,$2 FROM generate_series(1,$3)`,
        [client.id, config.USDG_TOKEN_ADDRESS.toLowerCase(), config.DAILY_CREATE_LIMIT],
      );
      const over = await call("POST", "/v1/jobs", client.token, {
        title: "One too many", description: "x", acceptanceCriteria: ["x"], asset: "usdg", amount: "1",
      });
      expect(over.status).toBe(429);
    });
  });

  // ---------- referral farming (H-1) ----------

  describe("referrals", () => {
    async function completedJobs(clientId: string, doerId: string, count: number, amountRaw = 1_000_000n) {
      await db.query(
        `INSERT INTO jobs (client_id,doer_id,title,description,acceptance_criteria,asset,amount_raw,token_address,status)
         SELECT $1,$2,'Done job','x','["x"]','usdg',$3,$4,'completed' FROM generate_series(1,$5)`,
        [clientId, doerId, amountRaw.toString(), config.USDG_TOKEN_ADDRESS.toLowerCase(), count],
      );
    }
    async function referredPair() {
      const referrer = await newUser();
      const referee = await newUser();
      const code = (await call("GET", "/v1/referrals", referrer.token)).body.data.code;
      expect((await call("POST", "/v1/referrals/redeem", referee.token, { code })).status).toBe(200);
      await db.query("UPDATE users SET referred_at=now()-interval '30 days' WHERE id=$1", [referee.id]);
      return { referrer, referee };
    }
    const bonuses = async (user: User) => (await call("GET", "/v1/referrals", user.token)).body.data.bonuses;

    test("self-dealt work never qualifies: referrer as client, or one client, or dust", async () => {
      const { referrer, referee } = await referredPair();
      await completedJobs(referrer.id, referee.id, 12);              // the referrer paying the referee
      const sock = await newUser();
      await completedJobs(sock.id, referee.id, 12, 1n);             // a fresh wallet paying dust
      const single = await newUser();
      await completedJobs(single.id, referee.id, 12);                // one real client
      expect(await bonuses(referee)).toEqual([]);
      expect(await bonuses(referrer)).toEqual([]);
    });

    test("clients linked through the referral graph do not count", async () => {
      const { referrer, referee } = await referredPair();
      // Three "clients" the referrer invited: the farm's natural shape.
      for (let i = 0; i < 3; i++) {
        const sock = await newUser();
        await db.query("UPDATE users SET referred_by=$2,referred_at=now() WHERE id=$1", [sock.id, referrer.id]);
        await completedJobs(sock.id, referee.id, 4);
      }
      expect(await bonuses(referee)).toEqual([]);
    });

    test("real third-party work creates bonuses that wait for team approval before a claim", async () => {
      const { referrer, referee } = await referredPair();
      for (let i = 0; i < 3; i++) await completedJobs((await newUser()).id, referee.id, 4);
      const [bonus] = await bonuses(referee);
      expect(bonus.status).toBe("pending_review");
      expect((await call("POST", `/v1/referrals/bonuses/${bonus.id}/claim`, referee.token)).body.error.code).toBe("bonus_pending_review");
      expect((await bonuses(referrer))[0].status).toBe("pending_review");

      const team = await teamUser();
      const pending = await call("GET", "/v1/team/referral-bonuses", team.token);
      expect(pending.body.data.find((b: any) => b.id === bonus.id).distinctClients).toBe(3);
      expect((await call("POST", `/v1/team/referral-bonuses/${bonus.id}/approve`, team.token)).status).toBe(200);
      expect((await call("POST", `/v1/team/referral-bonuses/${bonus.id}/approve`, team.token)).status).toBe(409);

      // The vault holds less than the bonus: the claim waits and the bonus stays claimable.
      const empty = await call("POST", `/v1/referrals/bonuses/${bonus.id}/claim`, referee.token);
      expect(empty.body.error.code).toBe("bonus_budget_exhausted");
      const vault = (await db.query("SELECT address FROM escrow_accounts WHERE kind='bonus_vault'")).rows[0].address;
      chain.balances.set(vault, usdg(Number(config.REFERRAL_BONUS_USDG)));
      expect((await call("POST", `/v1/referrals/bonuses/${bonus.id}/claim`, referee.token)).status).toBe(200);
      expect((await call("POST", `/v1/referrals/bonuses/${bonus.id}/claim`, referee.token)).status).toBe(409);

      // The referrer's approved bonus can't be paid from the same USDG: the first claim already owes it.
      const referrerBonus = (await bonuses(referrer))[0];
      await call("POST", `/v1/team/referral-bonuses/${referrerBonus.id}/approve`, team.token);
      expect((await call("POST", `/v1/referrals/bonuses/${referrerBonus.id}/claim`, referrer.token)).body.error.code).toBe("bonus_budget_exhausted");
    });
  });

  // ---------- stuck funds (M-1, M-2) ----------

  describe("stuck funds", () => {
    test("USDG that reaches a job after it expired is refunded through cancel", async () => {
      const client = await newUser();
      const job = await createJob(client, "2");
      await db.query("UPDATE jobs SET status='expired' WHERE id=$1", [job.id]);
      sendUsdg(client.wallet, job.escrowAddress, usdg(2));
      const listed = await call("GET", "/v1/recoverable", client.token);
      expect(listed.body.data.find((i: any) => i.id === job.id)?.action).toBe("cancel");
      const cancel = await call("POST", `/v1/jobs/${job.id}/cancel`, client.token);
      expect(cancel.status).toBe(202);
      const settlement = (await db.query("SELECT outcome,amount_raw::text FROM job_settlements WHERE job_id=$1", [job.id])).rows[0];
      expect(settlement).toEqual({ outcome: "refund_client", amount_raw: usdg(2).toString() });
    });

    test("a batch closed before /fund returns its unrecorded deposit, once", async () => {
      const client = await newUser();
      const batch = await createBatch(client);
      sendUsdg(client.wallet, batch.escrowAddress, BigInt(batch.totalRaw));
      expect((await call("POST", `/v1/batches/${batch.id}/close`, client.token)).body.data.status).toBe("cancelled");
      expect((await call("POST", `/v1/batches/${batch.id}/fund`, client.token, { transactionHash: `0x${"2".repeat(64)}` })).status).toBe(409);

      const listed = (await call("GET", "/v1/recoverable", client.token)).body.data.find((i: any) => i.id === batch.id);
      expect(listed.amount).toBe(batch.total);
      const recovered = await call("POST", `/v1/escrows/${listed.escrowId}/recover`, client.token);
      expect(recovered.status).toBe(202);
      expect(recovered.body.data.amount).toBe(batch.total);
      const transfer = (await db.query("SELECT kind,recipient,amount_raw::text FROM escrow_transfers WHERE escrow_id=$1", [listed.escrowId])).rows;
      expect(transfer).toEqual([{ kind: "surplus_refund", recipient: client.wallet, amount_raw: batch.totalRaw }]);
      // The refund is still on its way, so the same USDG cannot be recovered twice.
      expect((await call("POST", `/v1/escrows/${listed.escrowId}/recover`, client.token)).body.error.code).toBe("nothing_to_recover");
    });

    test("recorded deposits backing live work are never recoverable; only the excess is", async () => {
      const client = await newUser();
      const batch = await createBatch(client);
      const hash = sendUsdg(client.wallet, batch.escrowAddress, BigInt(batch.totalRaw));
      expect((await call("POST", `/v1/batches/${batch.id}/fund`, client.token, { transactionHash: hash })).status).toBe(200);
      const escrowId = (await db.query("SELECT escrow_id FROM batches WHERE id=$1", [batch.id])).rows[0].escrow_id;
      expect((await call("POST", `/v1/escrows/${escrowId}/recover`, client.token)).body.error.code).toBe("nothing_to_recover");
      sendUsdg(client.wallet, batch.escrowAddress, usdg(0.3)); // an accidental extra transfer
      const recovered = await call("POST", `/v1/escrows/${escrowId}/recover`, client.token);
      expect(recovered.body.data.amount).toBe("0.3");
    });

    test("a transfer already returned by a recovery cannot be recorded as funding afterwards", async () => {
      const client = await newUser();
      const batch = await createBatch(client);
      const hash = sendUsdg(client.wallet, batch.escrowAddress, BigInt(batch.totalRaw));
      const escrowId = (await db.query("SELECT escrow_id FROM batches WHERE id=$1", [batch.id])).rows[0].escrow_id;
      expect((await call("POST", `/v1/escrows/${escrowId}/recover`, client.token)).status).toBe(202);
      chain.balances.set(batch.escrowAddress, 0n); // the refund was mined
      const fund = await call("POST", `/v1/batches/${batch.id}/fund`, client.token, { transactionHash: hash });
      expect(fund.status).toBe(409);
      expect(fund.body.error.code).toBe("funding_not_held");
      expect((await db.query("SELECT status FROM batches WHERE id=$1", [batch.id])).rows[0].status).toBe("awaiting_funding");
    });
  });

  // ---------- failed payout retries (L-5) ----------

  test("a failed payout goes back to pending through a logged team retry", async () => {
    const team = await teamUser();
    const client = await newUser();
    const batch = await createBatch(client);
    const escrowId = (await db.query("SELECT escrow_id FROM batches WHERE id=$1", [batch.id])).rows[0].escrow_id;
    const transfer = (await db.query(
      `INSERT INTO escrow_transfers (escrow_id,kind,ref_id,recipient,amount_raw,status,nonce,signed_tx,tx_hash,error)
       VALUES ($1,'batch_refund',$2,$3,100000,'failed',0,'0x00','0x${"3".repeat(64)}','reverted') RETURNING id`,
      [escrowId, batch.id, client.wallet])).rows[0].id;
    const failed = await call("GET", "/v1/team/payouts/failed", team.token);
    expect(failed.body.data.map((t: any) => t.id)).toContain(transfer);
    expect((await call("POST", `/v1/team/payouts/${transfer}/retry`, team.token)).status).toBe(200);
    const row = (await db.query("SELECT status,signed_tx FROM escrow_transfers WHERE id=$1", [transfer])).rows[0];
    expect(row.signed_tx).toBeNull();
    expect((await db.query("SELECT count(*)::int AS n FROM escrow_transfer_retries WHERE transfer_id=$1", [transfer])).rows[0].n).toBe(1);
    expect((await call("POST", `/v1/team/payouts/${transfer}/retry`, (await newUser()).token)).status).toBe(403);
  });
});
