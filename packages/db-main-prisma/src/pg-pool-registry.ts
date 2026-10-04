import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';

const prismaOnlySearchParams = [
  'connection_limit',
  'pgbouncer',
  'pool_timeout',
  'schema',
  'statement_cache_size',
] as const;

export const PG_POOL_FACTORY = Symbol('PG_POOL_FACTORY');

export type PgPoolFactory = (config: PoolConfig) => Pool;
export const defaultPgPoolFactory: PgPoolFactory = (config) => new Pool(config);

export interface IPgPoolAcquireOptions {
  applicationName?: string;
  connectionTimeoutMillis?: number;
  max?: number;
  poolName?: string;
}

/** Fail fast on TCP connect instead of hanging on OS timeout (~75–130s+). */
export const DEFAULT_PG_POOL_CONNECTION_TIMEOUT_MS = 5000;

/**
 * Keep pooled connections warm when set to 0 — required for the PGlite wire
 * bridge, whose connection multiplexer can drop concurrent handshakes: a
 * connection established while other connections are mid-query may never
 * receive its startup reply. With warm, never-idle-closed connections the
 * pool stops re-handshaking at request time entirely.
 */
const resolveIdleTimeoutMillis = (): number | undefined =>
  parseNonNegativeInteger(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS);

/** pg default is 0 (never rotate); exposed for parity with the idle timeout. */
const resolveMaxLifetimeSeconds = (): number | undefined =>
  parseNonNegativeInteger(process.env.DATABASE_POOL_MAX_LIFETIME_SECONDS);

export interface IPgPoolSnapshot {
  applicationName: string;
  database: string;
  host: string;
  idle: number;
  max: number;
  poolName?: string;
  port?: number;
  references: number;
  total: number;
  waiting: number;
}

export interface IPgPoolLease {
  readonly pool: Pool;
  release(): Promise<void>;
}

interface IPgPoolEntry {
  applicationName: string;
  database: string;
  host: string;
  key: string;
  max: number;
  pool: Pool;
  poolName?: string;
  port?: number;
  references: number;
}

interface INormalizedPoolConfig {
  connectionString: string;
  database: string;
  host: string;
  key: string;
  max: number;
  poolName?: string;
  port?: number;
}

const parsePositiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseNonNegativeInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const resolveConnectionTimeoutMillis = (options: IPgPoolAcquireOptions): number =>
  parseNonNegativeInteger(options.connectionTimeoutMillis) ??
  parseNonNegativeInteger(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS) ??
  DEFAULT_PG_POOL_CONNECTION_TIMEOUT_MS;

const normalizePoolConfig = (
  connectionString: string,
  options: IPgPoolAcquireOptions
): INormalizedPoolConfig => {
  const url = new URL(connectionString);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Unsupported PostgreSQL connection protocol: ${url.protocol}`);
  }
  const max =
    parsePositiveInteger(options.max) ??
    parsePositiveInteger(process.env.DATABASE_POOL_MAX) ??
    parsePositiveInteger(url.searchParams.get('connection_limit')) ??
    20;

  for (const parameter of prismaOnlySearchParams) {
    url.searchParams.delete(parameter);
  }
  url.searchParams.sort();

  const normalizedConnectionString = url.toString();
  const identityUrl = new URL(normalizedConnectionString);
  identityUrl.protocol = 'postgresql:';
  if (!identityUrl.port) identityUrl.port = '5432';
  return {
    connectionString: normalizedConnectionString,
    database: url.pathname.replace(/^\//, ''),
    host: url.hostname,
    key: JSON.stringify([identityUrl.toString(), options.poolName ?? null]),
    max,
    ...(options.poolName !== undefined ? { poolName: options.poolName } : {}),
    port: Number(url.port || 5432),
  };
};

@Injectable()
export class PgPoolRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(PgPoolRegistry.name);
  private readonly entries = new Map<string, IPgPoolEntry>();
  private shuttingDown = false;

  constructor(
    @Inject(PG_POOL_FACTORY)
    private readonly poolFactory: PgPoolFactory
  ) {}

  acquire(connectionString: string, options: IPgPoolAcquireOptions = {}): IPgPoolLease {
    if (this.shuttingDown) {
      throw new Error('PostgreSQL pool registry is shutting down');
    }

    const normalized = normalizePoolConfig(connectionString, options);
    let entry = this.entries.get(normalized.key);
    if (!entry) {
      const applicationName = options.applicationName ?? 'teable';
      const pool = this.poolFactory({
        application_name: applicationName,
        connectionString: normalized.connectionString,
        connectionTimeoutMillis: resolveConnectionTimeoutMillis(options),
        idleTimeoutMillis: resolveIdleTimeoutMillis(),
        maxLifetimeSeconds: resolveMaxLifetimeSeconds(),
        max: normalized.max,
      });
      pool.on?.('error', (error) => {
        this.logger.error(
          `Unexpected idle PostgreSQL pool error for ${normalized.host}/${normalized.database}`,
          error instanceof Error ? error.stack : undefined
        );
      });
      // Temporary leak tracer for the PGlite bridge bring-up (PG_POOL_DEBUG=1):
      // prints every checkout/return so an acquired-but-never-released client is
      // visible in the console interleaved with request logs.
      if (process.env.PG_POOL_DEBUG === '1') {
        const tag = `[pgpool ${options.poolName ?? normalized.database}]`;
        const ts = () => new Date().toISOString().substring(11, 23);
        pool.on('connect', () => console.log(`${ts()} ${tag} +connect total=${pool.totalCount}`));
        pool.on('acquire', () =>
          console.log(`${ts()} ${tag} +acquire idle=${pool.idleCount}/${pool.totalCount}`)
        );
        pool.on('release', () =>
          console.log(`${ts()} ${tag} -release  idle=${pool.idleCount}/${pool.totalCount}`)
        );
        pool.on('remove', () => console.log(`${ts()} ${tag} -remove   total=${pool.totalCount}`));
      }
      entry = {
        applicationName,
        database: normalized.database,
        host: normalized.host,
        key: normalized.key,
        max: normalized.max,
        pool,
        ...(normalized.poolName !== undefined ? { poolName: normalized.poolName } : {}),
        port: normalized.port,
        references: 0,
      };
      this.entries.set(normalized.key, entry);
    } else if (entry.max !== normalized.max) {
      this.logger.warn(
        `Reusing PostgreSQL pool ${entry.host}/${entry.database} with max=${entry.max}; ignored requested max=${normalized.max}`
      );
    }

    entry.references += 1;
    let released = false;
    return {
      pool: entry.pool,
      release: async () => {
        if (released) return;
        released = true;
        await this.release(entry!);
      },
    };
  }

  snapshot(): IPgPoolSnapshot[] {
    return Array.from(this.entries.values())
      .map((entry) => ({
        applicationName: entry.applicationName,
        database: entry.database,
        host: entry.host,
        idle: entry.pool.idleCount,
        max: entry.max,
        ...(entry.poolName !== undefined ? { poolName: entry.poolName } : {}),
        ...(entry.port ? { port: entry.port } : {}),
        references: entry.references,
        total: entry.pool.totalCount,
        waiting: entry.pool.waitingCount,
      }))
      .sort((left, right) =>
        `${left.host}:${left.port ?? ''}/${left.database}/${left.poolName ?? ''}`.localeCompare(
          `${right.host}:${right.port ?? ''}/${right.database}/${right.poolName ?? ''}`
        )
      );
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(entries.map((entry) => entry.pool.end()));
  }

  private async release(entry: IPgPoolEntry): Promise<void> {
    const current = this.entries.get(entry.key);
    if (current !== entry) return;

    current.references -= 1;
    if (current.references > 0) return;

    this.entries.delete(entry.key);
    await entry.pool.end();
  }
}
