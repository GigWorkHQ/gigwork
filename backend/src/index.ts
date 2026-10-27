import { app } from "./app.js";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { runKeeper } from "./keeper.js";

await migrate();
const server = app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`GigWork API listening on port ${config.PORT}`);
});
const reconciliationTimer = setInterval(() => {
  void runKeeper().catch((error) => console.error("Keeper run failed:", error));
}, 30_000);
reconciliationTimer.unref();

async function shutdown() {
  clearInterval(reconciliationTimer);
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
