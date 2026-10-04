#!/usr/bin/env node
/**
 * PGlite wire bridge — the zero-container local "PostgreSQL server".
 *
 * Boots a PGlite instance (WASM Postgres, persisted to a local directory) and
 * exposes it over the PostgreSQL wire protocol, so Prisma / Knex / pg connect
 * exactly like they would to a real Postgres server. No SQL is changed anywhere.
 *
 * Usage:
 *   pnpm pglite:bridge
 *
 * Environment:
 *   PGLITE_DATA_DIR         data directory (default: <repo>/.data/teable)
 *   PGLITE_PORT             listen port (default: 5544)
 *   PGLITE_HOST             listen host (default: 127.0.0.1)
 *   PGLITE_MAX_CONNECTIONS  max concurrent wire connections (default: 8; queries are
 *                           queued at the query level, and the app keeps a single pooled
 *                           connection, so a small bound is enough headroom for the
 *                           backend plus short-lived prisma CLI connections)
 *   PGLITE_DEBUG            set to 1 for pglite-socket debug logging
 *
 * Keep this process running while the backend (`pnpm dev` in
 * apps/nestjs-backend) or prisma migrations are active — both connect to it.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');

const rawDir = process.env.PGLITE_DATA_DIR ?? path.join(repoRoot, '.data', 'teable');
const dataDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(repoRoot, rawDir);
const port = Number(process.env.PGLITE_PORT ?? 5544);
const host = process.env.PGLITE_HOST ?? '127.0.0.1';
// Hard-killed backend processes leave half-open sockets the server only
// notices on the next write, so the handler count creeps up over restart
// cycles during development — keep generous headroom above the app's
// pre-warmed pool (DATABASE_POOL_PREWARM / connection_limit) and the
// observation pool, and restart the bridge if it ever wedges.
const maxConnections = Number(process.env.PGLITE_MAX_CONNECTIONS ?? 64);
const debug = process.env.PGLITE_DEBUG === '1';
const inspect = process.env.PGLITE_INSPECT === '1';

mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create(dataDir);
console.log(`[pglite-bridge] data dir: ${dataDir}`);
console.log(
  `[pglite-bridge] ${((await db.query('SELECT version()')).rows[0] ?? {}).version ?? 'postgres ready'}`
);

const server = new PGLiteSocketServer({ db, host, port, maxConnections, debug, inspect });
await server.start();
console.log(`[pglite-bridge] listening on ${host}:${port} (maxConnections=${maxConnections})`);
console.log(
  `[pglite-bridge] connection string:\n` +
    `  postgresql://postgres:postgres@${host}:${port}/teable?schema=public&connection_limit=1&statement_cache_size=0`
);

let closing = false;
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  console.log(`[pglite-bridge] ${signal} received — closing...`);
  Promise.resolve(server.stop())
    .catch(() => undefined)
    .then(() => db.close())
    .catch(() => undefined)
    .finally(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
