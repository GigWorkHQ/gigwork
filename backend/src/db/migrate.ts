import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./index.js";

const directory = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

export async function migrate() {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('gigwork:schema_migrations'))");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const rows = await client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.rows.map((row) => [row.filename, row.checksum]));
    const missing = [...applied.keys()].filter((filename) => !files.includes(filename));
    if (missing.length) throw new Error(`Applied migrations are missing: ${missing.join(", ")}`);

    for (const filename of files) {
      const sql = await readFile(join(directory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(filename)) {
        if (applied.get(filename) !== checksum)
          throw new Error(`Migration ${filename} changed after it was applied.`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)", [
          filename,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('gigwork:schema_migrations'))").catch(
      () => undefined,
    );
    client.release();
  }
}

if (import.meta.main) migrate().finally(() => db.end());
