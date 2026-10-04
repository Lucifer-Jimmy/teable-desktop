import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { readComputedOutboxBoolean } from '../../../configs/computed-outbox-trigger.config';
import { V2Module } from '../v2.module';
import { BullMqComputedOutboxWakeupProcessor } from './bullmq-computed-outbox-wakeup.processor';
import { ComputedOutboxBaseAdmissionService } from './computed-outbox-base-admission.service';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';
import {
  hasRedisWakeupTransport,
  LocalComputedOutboxWakeupProcessor,
} from './local-computed-outbox-wakeup.publisher';

@Module({
  imports: [V2Module],
  providers: [
    ComputedOutboxBaseAdmissionService,
    ComputedOutboxWakeupHandler,
    BullMqComputedOutboxWakeupProcessor,
  ],
})
class ComputedOutboxWakeupConsumerRuntimeModule {}

/** Zero-container local mode: drains the in-process wakeup queue into the handler. */
@Module({
  imports: [V2Module],
  providers: [
    ComputedOutboxBaseAdmissionService,
    ComputedOutboxWakeupHandler,
    LocalComputedOutboxWakeupProcessor,
  ],
})
class LocalComputedOutboxWakeupConsumerRuntimeModule {}

@Module({})
export class ComputedOutboxWakeupConsumerModule {
  static async register(): Promise<DynamicModule> {
    const runtime = (await hasRedisWakeupTransport())
      ? ComputedOutboxWakeupConsumerRuntimeModule
      : LocalComputedOutboxWakeupConsumerRuntimeModule;

    return ConditionalModule.registerWhen(
      runtime,
      (env) => readComputedOutboxBoolean(env.V2_COMPUTED_OUTBOX_TRIGGER_CONSUMER_ENABLED, true),
      { timeout: process.env.NODE_ENV === 'test' ? 60_000 : 5000 }
    );
  }
}
