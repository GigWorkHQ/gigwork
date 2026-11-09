import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { call, chain, createBatch, db, enabled, newUser, startApp, stopApp } from "./harness.js";

// Model-based check of escrow accounting. Random sequences of recorded deposits, stray (unrecorded) transfers,
// payouts in every state, and client recoveries run against the real routes and schema, while a plain model tracks
// where every base unit came from. After each step:
//   1. recoveries never return more than the stray USDG that reached the escrow (recorded deposits stay put), and
//   2. everything the escrow has promised (payouts + recoveries) never exceeds what came in.
// At the end, once all in-flight transfers settle, one more recovery returns exactly the stray USDG still held.

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!enabled)("escrow accounting invariants", () => {
  beforeAll(startApp);
  afterAll(stopApp);

  for (const seed of Array.from({ length: 24 }, (_, i) => 1_000 + i * 7_919)) {
    test(`random sequence, seed ${seed}`, async () => {
      const rand = prng(seed);
      const amount = () => BigInt(1 + Math.floor(rand() * 5_000_000));
      const client = await newUser();
      const batch = await createBatch(client);
      const escrowId: string = (await db.query("SELECT escrow_id FROM batches WHERE id=$1", [batch.id])).rows[0].escrow_id;
      const address: string = batch.escrowAddress.toLowerCase();
      chain.balances.set(address, 0n);
      // Hold the payout lease so no background send touches transfer rows the model is driving by hand.
      await db.query("UPDATE escrow_accounts SET lease_until=now()+interval '1 day' WHERE id=$1", [escrowId]);
      const move = (delta: bigint) => chain.balances.set(address, (chain.balances.get(address) ?? 0n) + delta);

      const model = { deposits: 0n, stray: 0n, promised: 0n, recovered: 0n };
      const inFlight: Array<{ id: string; amount: bigint; hash: string; recovery: boolean }> = [];

      let nonce = 0;
      const insertTransfer = async (amt: bigint, state: "unsigned" | "mined" | "complete" | "failed") => {
        const hash = `0x${randomBytes(32).toString("hex")}`;
        const id = (await db.query(
          `INSERT INTO escrow_transfers (escrow_id,kind,ref_id,recipient,amount_raw,status,nonce,signed_tx,tx_hash)
           VALUES ($1,'assignment_pay',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [escrowId, randomUUID(), client.wallet, amt.toString(), state === "complete" ? "complete" : state === "failed" ? "failed" : "pending",
            state === "unsigned" ? null : nonce++, state === "unsigned" ? null : "0x00", state === "unsigned" ? null : hash])).rows[0].id;
        if (state === "mined" || state === "complete") move(-amt);
        if (state === "mined") { chain.transactions.set(hash, { from: address, to: client.wallet, amount: amt }); inFlight.push({ id, amount: amt, hash, recovery: false }); }
        if (state === "unsigned") inFlight.push({ id, amount: amt, hash: "", recovery: false });
        model.promised += amt;
      };

      for (let step = 0; step < 30; step++) {
        const roll = rand();
        if (roll < 0.25) {
          const amt = amount();
          await db.query(
            "INSERT INTO escrow_deposits (escrow_id,purpose,ref_id,tx_hash,from_wallet,amount_raw,block_number) VALUES ($1,'milestone',$2,$3,$4,$5,1)",
            [escrowId, randomUUID(), `0x${randomBytes(32).toString("hex")}`, client.wallet, amt.toString()]);
          move(amt);
          model.deposits += amt;
        } else if (roll < 0.4) {
          const amt = amount();
          move(amt);
          model.stray += amt;
        } else if (roll < 0.65) {
          // A payout can only spend recorded deposits that are not already promised to someone else.
          const room = model.deposits - (model.promised - model.recovered);
          if (room > 0n) {
            const amt = 1n + BigInt(Math.floor(rand() * Number(room)));
            const states = ["unsigned", "mined", "complete", "failed"] as const;
            await insertTransfer(amt, states[Math.floor(rand() * states.length)]);
          }
        } else if (roll < 0.8 && inFlight.length) {
          // Settle one in-flight transfer: an unsigned one is sent and mined, a mined one is marked complete.
          const [t] = inFlight.splice(Math.floor(rand() * inFlight.length), 1);
          if (!t.hash) move(-t.amount);
          await db.query("UPDATE escrow_transfers SET status='complete',completed_at=now() WHERE id=$1", [t.id]);
        } else {
          const result = await call("POST", `/v1/escrows/${escrowId}/recover`, client.token);
          if (result.status === 202) {
            const row = (await db.query("SELECT id,amount_raw::text FROM escrow_transfers WHERE escrow_id=$1 AND kind='surplus_refund' ORDER BY created_at DESC LIMIT 1", [escrowId])).rows[0];
            const amt = BigInt(row.amount_raw);
            model.recovered += amt;
            model.promised += amt;
            inFlight.push({ id: row.id, amount: amt, hash: "", recovery: true });
          } else {
            expect(result.body.error.code).toBe("nothing_to_recover");
          }
        }
        expect(model.recovered).toBeLessThanOrEqual(model.stray);
        expect(model.promised).toBeLessThanOrEqual(model.deposits + model.stray);
        expect(chain.balances.get(address)!).toBeGreaterThanOrEqual(0n);
      }

      // Drain: settle everything in flight, then the escrow must return exactly the stray USDG it still holds.
      for (const t of inFlight) {
        if (!t.hash) move(-t.amount);
        await db.query("UPDATE escrow_transfers SET status='complete',completed_at=now() WHERE id=$1", [t.id]);
      }
      const remaining = model.stray - model.recovered;
      const last = await call("POST", `/v1/escrows/${escrowId}/recover`, client.token);
      if (remaining === 0n) expect(last.body.error.code).toBe("nothing_to_recover");
      else expect(BigInt(Math.round(Number(last.body.data.amount) * 1_000_000))).toBe(remaining);
    });
  }
});
