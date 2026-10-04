import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { defaultComputedUpdateOutboxConfig } from '@teable/v2-adapter-table-repository-postgres';
import { Queue } from 'bullmq';

import { ComputedOutboxClaimConcurrencyService } from './computed-outbox-claim-concurrency.service';
import { COMPUTED_OUTBOX_WAKEUP_QUEUE } from './constants';

const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local leaseMs = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local owner = ARGV[3]
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZCARD', key) >= capacity then
  return 0
end
redis.call('ZADD', key, now + leaseMs, owner)
if redis.call('PTTL', key) < leaseMs * 2 then
  redis.call('PEXPIRE', key, leaseMs * 2)
end
return 1
`;

const RENEW_SCRIPT = `
local key = KEYS[1]
local owner = ARGV[1]
local leaseMs = tonumber(ARGV[2])
local expiresAt = redis.call('ZSCORE', key, owner)
if expiresAt == false then
  return 0
end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(expiresAt) <= now then
  redis.call('ZREM', key, owner)
  if redis.call('ZCARD', key) == 0 then
    redis.call('DEL', key)
  end
  return 0
end
redis.call('ZADD', key, 'XX', now + leaseMs, owner)
if redis.call('PTTL', key) < leaseMs * 2 then
  redis.call('PEXPIRE', key, leaseMs * 2)
end
return 1
`;

const RELEASE_SCRIPT = `
local key = KEYS[1]
local owner = ARGV[1]
local removed = redis.call('ZREM', key, owner)
if redis.call('ZCARD', key) == 0 then
  redis.call('DEL', key)
end
return removed
`;

const DEFAULT_ADMISSION_CAPACITY = defaultComputedUpdateOutboxConfig.maxConcurrentProcessingPerBase;
const LEASE_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;
const RENEW_TIMEOUT_MS = 5000;

export class ComputedOutboxBaseAdmissionLeaseLostError extends Error {
  constructor(
    readonly baseId: string,
    options?: ErrorOptions
  ) {
    super(`Computed outbox base admission lease lost: ${baseId}`, options);
    this.name = 'ComputedOutboxBaseAdmissionLeaseLostError';
  }
}

export type ComputedOutboxBaseAdmissionResult<T> =
  | { admitted: false }
  | { admitted: true; value: T };

export type ComputedOutboxBaseAdmissionPermit = {
  assertActive(): void;
};

const resolveAdmissionKey = (baseId: string): string => {
  const queuePrefix = process.env.BACKEND_QUEUE_PREFIX ?? 'bull';
  return `${queuePrefix}:${COMPUTED_OUTBOX_WAKEUP_QUEUE}:admission:{${baseId}}`;
};

/**
 * In-process lease registry mirroring the Redis Lua admission scripts for
 * zero-container local mode (no Redis / no BullMQ). Single-process semantics:
 * Date.now() replaces redis TIME, and expired entries are pruned lazily on access.
 */
class LocalAdmissionLeaseStore {
  private readonly leases = new Map<string, Map<string, number>>();

  private prune(key: string, now: number): void {
    const owners = this.leases.get(key);
    if (!owners) return;
    for (const [owner, expiresAt] of owners) {
      if (expiresAt <= now) owners.delete(owner);
    }
    if (owners.size === 0) this.leases.delete(key);
  }

  acquire(key: string, leaseMs: number, capacity: number, owner: string): number {
    const now = Date.now();
    this.prune(key, now);
    const owners = this.leases.get(key);
    if (owners && owners.size >= capacity) return 0;
    if (owners) owners.set(owner, now + leaseMs);
    else this.leases.set(key, new Map([[owner, now + leaseMs]]));
    return 1;
  }

  renew(key: string, owner: string, leaseMs: number): number {
    const now = Date.now();
    const owners = this.leases.get(key);
    const expiresAt = owners?.get(owner);
    if (owners === undefined || expiresAt === undefined) return 0;
    if (expiresAt <= now) {
      owners.delete(owner);
      if (owners.size === 0) this.leases.delete(key);
      return 0;
    }
    owners.set(owner, now + leaseMs);
    return 1;
  }

  release(key: string, owner: string): number {
    const owners = this.leases.get(key);
    if (!owners?.delete(owner)) return 0;
    if (owners.size === 0) this.leases.delete(key);
    return 1;
  }
}

@Injectable()
export class ComputedOutboxBaseAdmissionService {
  private readonly logger = new Logger(ComputedOutboxBaseAdmissionService.name);
  private readonly localLeases = new LocalAdmissionLeaseStore();

  constructor(
    @InjectQueue(COMPUTED_OUTBOX_WAKEUP_QUEUE)
    @Optional()
    private readonly queue?: Queue,
    @Optional()
    private readonly claimConcurrency?: ComputedOutboxClaimConcurrencyService
  ) {}

  /**
   * Admission must track the effective per-base claim cap, or a raised cap
   * would still be throttled here. BYODB bases keep their env-default claim
   * caps; the DB-side claim gate stays authoritative for them.
   */
  private get capacity(): number {
    return this.claimConcurrency?.effective.perBase ?? DEFAULT_ADMISSION_CAPACITY;
  }

  async runWithPermit<T>(
    baseId: string,
    operation: (permit: ComputedOutboxBaseAdmissionPermit) => Promise<T>
  ): Promise<ComputedOutboxBaseAdmissionResult<T>> {
    const key = resolveAdmissionKey(baseId);
    const owner = randomUUID();
    const acquisitionStartedAt = performance.now();
    const acquired = Number(
      await this.eval(ACQUIRE_SCRIPT, [key], [LEASE_MS, this.capacity, owner])
    );
    if (acquired !== 1) return { admitted: false };
    let activeUntil = acquisitionStartedAt + LEASE_MS;

    let leaseLost: ComputedOutboxBaseAdmissionLeaseLostError | undefined;
    let renewInFlight: Promise<void> | undefined;
    const markLeaseLost = (error?: unknown): void => {
      if (leaseLost) return;
      leaseLost = new ComputedOutboxBaseAdmissionLeaseLostError(
        baseId,
        error === undefined ? undefined : { cause: error }
      );
      this.logger.error('computed:outbox:admission_lease_lost', {
        baseId,
        error:
          error instanceof Error ? error.message : error === undefined ? undefined : String(error),
      });
    };
    const permit: ComputedOutboxBaseAdmissionPermit = {
      assertActive: () => {
        if (!leaseLost && performance.now() >= activeUntil) markLeaseLost();
        if (leaseLost) throw leaseLost;
      },
    };
    const renewLease = async (): Promise<void> => {
      let timeout: NodeJS.Timeout | undefined;
      const renewalStartedAt = performance.now();
      try {
        const renewed = await Promise.race([
          this.eval(RENEW_SCRIPT, [key], [owner, LEASE_MS]),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Computed outbox base admission renewal timed out')),
              RENEW_TIMEOUT_MS
            );
            timeout.unref();
          }),
        ]);
        if (Number(renewed) === 1) activeUntil = renewalStartedAt + LEASE_MS;
        else markLeaseLost();
      } catch (error) {
        markLeaseLost(error);
      } finally {
        clearTimeout(timeout);
      }
    };
    const renew = setInterval(() => {
      if (renewInFlight || leaseLost) return;
      renewInFlight = renewLease().finally(() => {
        renewInFlight = undefined;
      });
    }, RENEW_INTERVAL_MS);
    renew.unref();

    try {
      permit.assertActive();
      const value = await operation(permit);
      if (renewInFlight) await renewInFlight;
      permit.assertActive();
      return { admitted: true, value };
    } finally {
      clearInterval(renew);
      if (renewInFlight) await renewInFlight;
      await this.eval(RELEASE_SCRIPT, [key], [owner]).catch((error: unknown) => {
        this.logger.warn('computed:outbox:admission_release_failed', {
          baseId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    // Zero-container local mode: no BullMQ queue — serve the lease scripts from
    // the in-process registry instead of Redis.
    if (!this.queue) {
      const key = keys[0];
      if (script === ACQUIRE_SCRIPT) {
        return this.localLeases.acquire(key, Number(args[0]), Number(args[1]), String(args[2]));
      }
      if (script === RENEW_SCRIPT) {
        return this.localLeases.renew(key, String(args[0]), Number(args[1]));
      }
      if (script === RELEASE_SCRIPT) {
        return this.localLeases.release(key, String(args[0]));
      }
      throw new Error('Unknown admission lease script for local mode');
    }
    const redis = await this.queue.client;
    return redis.eval(script, keys.length, ...keys, ...args);
  }
}
