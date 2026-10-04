import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type {
  ComputedOutboxWakeup,
  ComputedOutboxWakeupPublishOutcome,
  ComputedOutboxWakeupSkipReason,
  IComputedOutboxWakeupPublisher,
} from '@teable/v2-adapter-table-repository-postgres';

import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';
import type { ComputedOutboxWakeupWire } from './computed-outbox-wakeup.wire';

/**
 * In-process wakeup transport for zero-container local mode (no Redis / no BullMQ).
 *
 * Mirrors the BullMQ topology with two halves:
 * - `LocalComputedOutboxWakeupQueue` + `LocalComputedOutboxWakeupPublisher` live on the
 *   producer side (provided by ComputedOutboxWakeupProducerModule when no Redis URI is set).
 * - `LocalComputedOutboxWakeupProcessor` lives on the consumer side (provided by
 *   ComputedOutboxWakeupConsumerModule) and drains the queue into ComputedOutboxWakeupHandler.
 *
 * At-least-once semantics are preserved the same way as with BullMQ: the durable outbox
 * row plus the monitor/redrive services re-publish anything a failed dispatch misses.
 */

/**
 * Resolves whether the Redis/BullMQ wakeup transport should be used.
 *
 * Module `register()` methods run while decorators evaluate — before GlobalModule's
 * ConfigModule has parsed the .env files — so this awaits the config module's
 * "env loaded" promise first, mirroring the deferral ConditionalModule.registerWhen
 * does for the consumer and event-job queues.
 */
export const hasRedisWakeupTransport = async (): Promise<boolean> => {
  await NestConfigModule.envVariablesLoaded;
  return Boolean(process.env.BACKEND_CACHE_REDIS_URI);
};

@Injectable()
export class LocalComputedOutboxWakeupQueue implements OnModuleDestroy {
  private readonly logger = new Logger(LocalComputedOutboxWakeupQueue.name);
  private drain: ((wakeup: ComputedOutboxWakeupWire) => Promise<unknown>) | undefined;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  registerDrain(drain: (wakeup: ComputedOutboxWakeupWire) => Promise<unknown>): void {
    this.drain = drain;
  }

  enqueue(wakeup: ComputedOutboxWakeupWire): void {
    const delayMs = Math.max(0, new Date(wakeup.availableAt).getTime() - Date.now());
    const dispatch = () => {
      try {
        const outcome = this.drain?.(wakeup);
        outcome?.catch((error: unknown) => {
          this.logger.error(
            `local wakeup dispatch failed (taskId=${wakeup.taskId}, wakeupId=${wakeup.wakeupId})`,
            error instanceof Error ? error.stack : String(error)
          );
        });
      } catch (error) {
        this.logger.error(
          `local wakeup dispatch threw synchronously (taskId=${wakeup.taskId})`,
          error instanceof Error ? error.stack : String(error)
        );
      }
    };
    if (delayMs === 0) {
      setImmediate(dispatch);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      dispatch();
    }, delayMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

export class LocalComputedOutboxWakeupPublisher implements IComputedOutboxWakeupPublisher {
  constructor(
    private readonly queue: LocalComputedOutboxWakeupQueue,
    private readonly metrics: ComputedOutboxTriggerMetrics
  ) {}

  async publish(wakeup: ComputedOutboxWakeup): Promise<ComputedOutboxWakeupPublishOutcome> {
    const wire: ComputedOutboxWakeupWire = {
      schemaVersion: wakeup.schemaVersion,
      wakeupId: wakeup.wakeupId,
      taskId: wakeup.taskId,
      baseId: wakeup.baseId,
      availableAt: wakeup.availableAt.toISOString(),
      emittedAt: wakeup.emittedAt.toISOString(),
      cause: wakeup.cause,
      ...(wakeup.traceparent ? { traceparent: wakeup.traceparent } : {}),
      ...(wakeup.tracestate ? { tracestate: wakeup.tracestate } : {}),
    };
    this.queue.enqueue(wire);
    this.metrics.recordPublish('accepted', wakeup.cause);
    return { status: 'accepted' };
  }

  recordSkip(reason: ComputedOutboxWakeupSkipReason): void {
    this.metrics.recordPublishSkip(reason);
  }

  /**
   * No broker to recover from — an in-process dispatch cannot lose a wakeup after
   * it has been accepted, so recovery listeners are never invoked.
   */
  onDeliveryRecovered(): () => void {
    return () => undefined;
  }
}

@Injectable()
export class LocalComputedOutboxWakeupProcessor implements OnApplicationBootstrap {
  constructor(
    private readonly queue: LocalComputedOutboxWakeupQueue,
    private readonly handler: ComputedOutboxWakeupHandler
  ) {}

  onApplicationBootstrap(): void {
    this.queue.registerDrain((wakeup) => this.handler.handle(wakeup));
  }
}
