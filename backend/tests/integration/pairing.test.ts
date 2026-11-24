import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, db, enabled, newUser, startApp, stopApp, teamUser } from "./harness.js";

describe.skipIf(!enabled)("companion app pairing", () => {
  beforeAll(startApp);
  afterAll(stopApp);

  async function pair(token: string, deviceName = "Pixel 9") {
    const code = await call("POST", "/v1/pairing/codes", token);
    expect(code.status).toBe(201);
    expect(code.body.data.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    return { code: code.body.data.code as string, redeem: () => call("POST", "/v1/auth/pair", undefined, { code: code.body.data.code, deviceName }) };
  }

  test("a code from the web gives the phone a session on the same account, once", async () => {
    const web = await newUser();
    const { code, redeem } = await pair(web.token);
    const paired = await redeem();
    expect(paired.status).toBe(201);
    expect(paired.body.data.walletAddress).toBe(web.wallet);
    const me = await call("GET", "/v1/auth/me", paired.body.data.token);
    expect(me.body.data).toMatchObject({ userId: web.id, viaDevice: true });
    // Single use, in any spelling.
    expect((await call("POST", "/v1/auth/pair", undefined, { code: code.toLowerCase().replace("-", " ") })).status).toBe(401);
  });

  test("lower case, spaces and a missing dash are the same code; junk is refused without a lookup", async () => {
    const web = await newUser();
    const { code } = await pair(web.token);
    expect((await call("POST", "/v1/auth/pair", undefined, { code: code.replace("-", "").toLowerCase() })).status).toBe(201);
    expect((await call("POST", "/v1/auth/pair", undefined, { code: "IIII-0000" })).body.error.code).toBe("invalid_pairing_code");
  });

  test("an expired code and a replaced code don't work", async () => {
    const web = await newUser();
    const first = await pair(web.token);
    const second = await pair(web.token); // asking again replaces the first code
    expect((await first.redeem()).status).toBe(401);
    await db.query("UPDATE pairing_codes SET created_at=now()-interval '20 minutes', expires_at=now()-interval '1 minute' WHERE user_id=$1", [web.id]);
    expect((await second.redeem()).body.error.code).toBe("pairing_code_invalid");
  });

  test("a paired phone acts as the account but can't mint keys, pair more phones or use team powers", async () => {
    const team = await teamUser();
    const phone = (await (await pair(team.token)).redeem()).body.data.token;
    expect((await call("GET", "/v1/jobs/mine", phone)).status).toBe(200);
    expect((await call("GET", "/v1/referrals", phone)).status).toBe(200);
    expect((await call("POST", "/v1/me/api-keys", phone, { label: "x" })).body.error.code).toBe("browser_wallet_required");
    expect((await call("POST", "/v1/pairing/codes", phone)).body.error.code).toBe("browser_wallet_required");
    expect((await call("GET", "/v1/team/reviewers", phone)).body.error.code).toBe("wallet_session_required");
  });

  test("the web lists paired phones and can remove one; the phone is signed out at once", async () => {
    const web = await newUser();
    const phone = (await (await pair(web.token, "Galaxy S25")).redeem()).body.data;
    const listed = await call("GET", "/v1/devices", web.token);
    expect(listed.body.data).toEqual([expect.objectContaining({ id: phone.sessionId, name: "Galaxy S25", thisDevice: false })]);
    expect((await call("DELETE", `/v1/devices/${phone.sessionId}`, (await newUser()).token)).status).toBe(404);
    expect((await call("DELETE", `/v1/devices/${phone.sessionId}`, web.token)).status).toBe(204);
    expect((await call("GET", "/v1/auth/me", phone.token)).status).toBe(401);
  });

  test("a phone can unpair itself but not other phones", async () => {
    const web = await newUser();
    const a = (await (await pair(web.token, "Phone A")).redeem()).body.data;
    const b = (await (await pair(web.token, "Phone B")).redeem()).body.data;
    expect((await call("DELETE", `/v1/devices/${b.sessionId}`, a.token)).body.error.code).toBe("browser_wallet_required");
    expect((await call("GET", "/v1/devices", a.token)).body.data.find((d: any) => d.id === a.sessionId).thisDevice).toBe(true);
    expect((await call("DELETE", `/v1/devices/${a.sessionId}`, a.token)).status).toBe(204);
    expect((await call("GET", "/v1/auth/me", a.token)).status).toBe(401);
    expect((await call("GET", "/v1/auth/me", b.token)).status).toBe(200);
  });

  test("API keys can't create pairing codes either", async () => {
    const web = await newUser();
    const key = (await call("POST", "/v1/me/api-keys", web.token, { label: "agent" })).body.data.key;
    expect((await call("POST", "/v1/pairing/codes", key)).body.error.code).toBe("browser_wallet_required");
  });
});
