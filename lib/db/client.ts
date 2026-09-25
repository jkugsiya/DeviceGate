import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;
/** Accepted by helpers that may run inside a transaction. */
export type DbOrTx = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

/** Opens a SQLite database with the pragmas the gateway relies on. */
export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

export function migrateDb(db: DB) {
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
}

// Survives dev HMR, which would otherwise open a new connection per reload.
const globalForDb = globalThis as unknown as { __gatewayDb?: DB };

export function db(): DB {
  globalForDb.__gatewayDb ??= openDb(process.env.DATABASE_PATH ?? "./data/gateway.db");
  return globalForDb.__gatewayDb;
}
