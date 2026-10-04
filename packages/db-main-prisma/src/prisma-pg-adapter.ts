import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool, PoolClient, QueryResult } from 'pg';

const prismaTextCompatibleTypeOids = new Set([
  19, // name: PostgreSQL catalog and information_schema identifiers
]);
const postgresTextTypeOid = 25;

const normalizeQueryResult = <T extends QueryResult | QueryResult[]>(result: T): T => {
  if (Array.isArray(result)) {
    return result.map((item) => normalizeQueryResult(item)) as T;
  }

  if (!result.fields.some((field) => prismaTextCompatibleTypeOids.has(field.dataTypeID))) {
    return result;
  }

  return {
    ...result,
    fields: result.fields.map((field) =>
      prismaTextCompatibleTypeOids.has(field.dataTypeID)
        ? { ...field, dataTypeID: postgresTextTypeOid }
        : field
    ),
  } as T;
};

const adapterDebug = (message: string): void => {
  if (process.env.PG_POOL_DEBUG === '1') {
    console.log(`${new Date().toISOString().substring(11, 23)} [pgadapter] ${message}`);
  }
};

const firstQueryText = (arg: unknown): string => {
  if (typeof arg === 'string') return arg;
  const text = (arg as { text?: string } | null)?.text;
  return typeof text === 'string' ? text : '(structured)';
};

const wrapQueryable = <T extends Pool | PoolClient>(queryable: T): T =>
  new Proxy(queryable, {
    get(target, property, receiver) {
      if (property === 'query') {
        return async (...args: unknown[]) => {
          adapterDebug(`client.query: ${firstQueryText(args[0]).substring(0, 60)}`);
          try {
            const result = await Reflect.apply(target.query, target, args);
            adapterDebug(`client.query done: ${firstQueryText(args[0]).substring(0, 60)}`);
            return normalizeQueryResult(result);
          } catch (error) {
            adapterDebug(
              `client.query FAILED: ${firstQueryText(args[0]).substring(0, 60)} — ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            throw error;
          }
        };
      }
      if (property === 'release') {
        adapterDebug('client.release');
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

/**
 * Prisma 6.2's pg adapter rejects PostgreSQL's textual `name` OID before its
 * configured type parser runs. Keep the process-owned pool untouched for
 * Knex/Kysely while normalizing result metadata only on Prisma's view.
 */
export const createPrismaPgAdapter = (pool: Pool, schema?: string): PrismaPg => {
  const prismaPool = new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'connect') {
        return async () => {
          adapterDebug('pool.connect requested');
          const client = await target.connect();
          adapterDebug('pool.connect acquired');
          return wrapQueryable(client);
        };
      }
      if (property === 'query') {
        return async (...args: unknown[]) => {
          adapterDebug(`pool.query: ${firstQueryText(args[0]).substring(0, 60)}`);
          const result = await Reflect.apply(target.query, target, args);
          return normalizeQueryResult(result);
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new PrismaPg(prismaPool, schema ? { schema } : undefined);
};

export const normalizePrismaPgQueryResult = normalizeQueryResult;
