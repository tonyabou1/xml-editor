import pg from "pg";
import "./env.mjs";

const { Pool } = pg;

let pool;

export function getDatabaseConfig() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return {
      connectionString,
      ssl: process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined,
    };
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "dita_editor",
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || undefined,
  };
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      ...getDatabaseConfig(),
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30_000),
      connectionTimeoutMillis: Number(process.env.PGPOOL_CONNECTION_TIMEOUT_MS || 3_000),
      allowExitOnIdle: true,
    });
  }

  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function getDatabaseStatus() {
  try {
    const result = await query(`
      select
        current_database() as database,
        current_user as user,
        now() as checked_at
    `);

    return {
      configured: true,
      ok: true,
      ...result.rows[0],
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error.message,
      hint: "Set DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD for your local Postgres.",
    };
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
