import { AsyncLocalStorage } from 'node:async_hooks';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { DynamicModule, FactoryProvider } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { IComputedOutboxWakeupPublisher } from '@teable/v2-adapter-table-repository-postgres';
import type { Queue } from 'bullmq';

import {
  computedOutboxTriggerConfig,
  type IComputedOutboxTriggerConfig,
} from '../../../configs/computed-outbox-trigger.config';
import { ConfigModule } from '../../../configs/config.module';
import { BullMqComputedOutboxWakeupPublisher } from './bullmq-computed-outbox-wakeup.publisher';
import { ComputedOutboxTriggerMetrics } from './computed-outbox-trigger.metrics';
import type { IComputedOutboxWakeupAppPublisher } from './computed-outbox-wakeup.publisher';
import {
  hasRedisWakeupTransport,
  LocalComputedOutboxWakeupPublisher,
  LocalComputedOutboxWakeupQueue,
} from './local-computed-outbox-wakeup.publisher';
import { COMPUTED_OUTBOX_WAKEUP_PUBLISHER, COMPUTED_OUTBOX_WAKEUP_QUEUE } from './constants';

export const createRoleAwareWakeupPublisher = (
  publisher: IComputedOutboxWakeupPublisher,
  roles: Pick<IComputedOutboxTriggerConfig, 'producerEnabled' | 'consumerEnabled'>
): IComputedOutboxWakeupAppPublisher => {
  const consumerScope = new AsyncLocalStorage<boolean>();

  return {
    publish: async (wakeup) => {
      const consumerCanPublish = roles.consumerEnabled && consumerScope.getStore() === true;
      if (!roles.producerEnabled && !consumerCanPublish) {
        return { status: 'disabled' as const };
      }
      return publisher.publish(wakeup);
    },
    runAsConsumer: (operation) => consumerScope.run(true, operation),
    recordSkip: (reason) => publisher.recordSkip?.(reason),
    onDeliveryRecovered: (listener) =>
      publisher.onDeliveryRecovered?.(listener) ?? (() => undefined),
  };
};

const publisherProvider: FactoryProvider<IComputedOutboxWakeupAppPublisher> = {
  provide: COMPUTED_OUTBOX_WAKEUP_PUBLISHER,
  inject: [
    computedOutboxTriggerConfig.KEY,
    getQueueToken(COMPUTED_OUTBOX_WAKEUP_QUEUE),
    ComputedOutboxTriggerMetrics,
  ],
  useFactory: (
    config: IComputedOutboxTriggerConfig,
    queue: Queue,
    metrics: ComputedOutboxTriggerMetrics
  ) => {
    const bullPublisher = new BullMqComputedOutboxWakeupPublisher(
      queue,
      metrics,
      config.publishTimeoutMs
    );
    return createRoleAwareWakeupPublisher(bullPublisher, config);
  },
};

const localPublisherProvider: FactoryProvider<IComputedOutboxWakeupAppPublisher> = {
  provide: COMPUTED_OUTBOX_WAKEUP_PUBLISHER,
  inject: [
    computedOutboxTriggerConfig.KEY,
    LocalComputedOutboxWakeupQueue,
    ComputedOutboxTriggerMetrics,
  ],
  useFactory: (
    config: IComputedOutboxTriggerConfig,
    queue: LocalComputedOutboxWakeupQueue,
    metrics: ComputedOutboxTriggerMetrics
  ) => {
    const localPublisher = new LocalComputedOutboxWakeupPublisher(queue, metrics);
    return createRoleAwareWakeupPublisher(localPublisher, config);
  },
};

@Module({})
export class ComputedOutboxWakeupProducerModule {
  static async register(): Promise<DynamicModule> {
    // Zero-container local mode: no Redis URI — serve wake-ups from an in-process
    // queue instead of a BullMQ queue. The consumer side (draining into
    // ComputedOutboxWakeupHandler) is mounted by ComputedOutboxWakeupConsumerModule.
    if (!(await hasRedisWakeupTransport())) {
      return {
        module: ComputedOutboxWakeupProducerModule,
        imports: [ConfigModule],
        providers: [
          ComputedOutboxTriggerMetrics,
          LocalComputedOutboxWakeupQueue,
          localPublisherProvider,
        ],
        exports: [
          ComputedOutboxTriggerMetrics,
          COMPUTED_OUTBOX_WAKEUP_PUBLISHER,
          LocalComputedOutboxWakeupQueue,
        ],
      };
    }

    const bullQueue = BullModule.registerQueue({ name: COMPUTED_OUTBOX_WAKEUP_QUEUE });

    return {
      module: ComputedOutboxWakeupProducerModule,
      imports: [ConfigModule, bullQueue],
      providers: [ComputedOutboxTriggerMetrics, publisherProvider],
      exports: [ComputedOutboxTriggerMetrics, COMPUTED_OUTBOX_WAKEUP_PUBLISHER, bullQueue],
    };
  }
}
