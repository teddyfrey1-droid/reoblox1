// @ts-check
/**
 * Database adapter layer.
 *
 * Provides ONE uniform interface — { query, exec, tx, close } — over two backends:
 *   - PGlite (embedded WASM Postgres) for tests/CI and zero-infra local runs.
 *   - node-postgres `pg.Pool` for production (lazy-imported; an optional dependency).
 *
 * PgStore depends only on this interface, so the exact same persistence code is
 * verified against a real Postgres engine in the test suite and runs against a
 * managed Postgres in production.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

/**
 * @typedef {Object} Db
 * @property {(sql:string, params?:any[]) => Promise<{rows:any[]}>} query  parameterised query
 * @property {(sql:string) => Promise<void>} exec                          multi-statement script
 * @property {(fn:(q:(sql:string, params?:any[]) => Promise<{rows:any[]}>) => Promise<any>) => Promise<any>} tx  transaction
 * @property {() => Promise<void>} close
 */

/**
 * Wrap a PGlite instance as a Db. PGlite is single-connection, so transactions use
 * its native `.transaction()` helper.
 * @param {any} pglite
 * @returns {Db}
 */
export function pgliteAdapter(pglite) {
  return {
    query: (sql, params = []) => pglite.query(sql, params),
    exec: (sql) => pglite.exec(sql),
    tx: (fn) => pglite.transaction((txn) => fn((sql, params = []) => txn.query(sql, params))),
    close: () => pglite.close?.() ?? Promise.resolve(),
  };
}

/**
 * Wrap a node-postgres Pool as a Db. Transactions check out a dedicated client so
 * BEGIN/COMMIT run on a single connection.
 * @param {any} pool
 * @returns {Db}
 */
export function pgPoolAdapter(pool) {
  return {
    query: (sql, params = []) => pool.query(sql, params),
    exec: (sql) => pool.query(sql).then(() => undefined),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((sql, params = []) => client.query(sql, params));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Open a production Postgres pool from a connection string. `pg` is lazy-imported
 * (an optional dependency) so the default in-memory mode needs nothing installed.
 * @param {string} databaseUrl
 * @returns {Promise<Db>}
 */
export async function openPostgres(databaseUrl) {
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    throw new Error("DATABASE_URL is set but the 'pg' package is not installed. Run: npm install pg");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: Number(process.env.PG_POOL_MAX) || 10 });
  return pgPoolAdapter(pool);
}

/** Apply db/schema.sql to a database. The DDL is authoritative (bare CREATE TABLE). */
export async function applySchema(db) {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  await db.exec(sql);
}

/** Apply the schema only if it hasn't been applied yet (safe to call on every boot). */
export async function ensureSchema(db) {
  try {
    await db.query('SELECT 1 FROM players LIMIT 1'); // probe: throws if table missing
  } catch {
    await applySchema(db);
  }
}
