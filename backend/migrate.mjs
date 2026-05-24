import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function getAppliedMigrationIds(client) {
  const result = await client.query("select id from schema_migrations");
  return new Set(result.rows.map((row) => row.id));
}

async function runMigrations() {
  const pool = getPool();
  let client;

  try {
    client = await pool.connect();
    await ensureMigrationsTable(client);

    const appliedIds = await getAppliedMigrationIds(client);
    const migrationFiles = (await readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();

    const appliedNow = [];

    for (const fileName of migrationFiles) {
      if (appliedIds.has(fileName)) continue;

      const sql = await readFile(path.join(migrationsDir, fileName), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (id) values ($1)", [fileName]);
        await client.query("commit");
        appliedNow.push(fileName);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }

    if (appliedNow.length) {
      console.log(`Applied migrations: ${appliedNow.join(", ")}`);
    } else {
      console.log("Database schema is already up to date.");
    }
  } finally {
    client?.release();
    await closePool();
  }
}

runMigrations().catch((error) => {
  console.error(error);
  process.exit(1);
});
