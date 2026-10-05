import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { IUndoRedoOperation } from '../../../cache/types';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';

/**
 * Unique per-boot epoch for undo/redo stack keys.
 *
 * The stacks live in the shared cache (sqlite in local mode) with a 24h TTL.
 * Without a boot discriminator, a stack written before a backend restart
 * stays reachable after it; a browser tab that reconnected without a full
 * reload keeps the same window id, and any trigger of undo/redo (including
 * the errant replays observed during development) then executes operations
 * recorded against table/field versions that no longer exist — silently
 * deleting tables and reverting record edits. Keying by boot epoch makes
 * every prior session's stacks unreachable immediately on restart; they
 * then age out via TTL without needing pattern deletion in the cache store.
 */
const BOOT_EPOCH = `b${Date.now().toString(36)}`;

@Injectable()
export class UndoRedoStackService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cacheService: CacheService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private undoKey(
    userId: string,
    tableId: string,
    windowId: string
  ): `operations:undo:${string}:${string}:${string}:${string}` {
    return `operations:undo:${BOOT_EPOCH}:${userId}:${tableId}:${windowId}`;
  }

  private redoKey(
    userId: string,
    tableId: string,
    windowId: string
  ): `operations:redo:${string}:${string}:${string}:${string}` {
    return `operations:redo:${BOOT_EPOCH}:${userId}:${tableId}:${windowId}`;
  }

  private async getUndoStack(userId: string, tableId: string, windowId: string) {
    return (await this.cacheService.get(this.undoKey(userId, tableId, windowId))) || [];
  }

  private async getRedoStack(userId: string, tableId: string, windowId: string) {
    return (await this.cacheService.get(this.redoKey(userId, tableId, windowId))) || [];
  }

  private async setUndoStack(
    userId: string,
    tableId: string,
    windowId: string,
    undoStack: IUndoRedoOperation[]
  ) {
    await this.cacheService.set(
      this.undoKey(userId, tableId, windowId),
      undoStack,
      this.thresholdConfig.undoExpirationTime
    );
  }

  private async setRedoStack(
    userId: string,
    tableId: string,
    windowId: string,
    redoStack: IUndoRedoOperation[]
  ) {
    await this.cacheService.set(
      this.redoKey(userId, tableId, windowId),
      redoStack,
      this.thresholdConfig.undoExpirationTime
    );
  }

  async push(
    userId: string,
    tableId: string,
    windowId: string,
    operation: IUndoRedoOperation
  ): Promise<void> {
    const maxUndoStackSize = this.thresholdConfig.maxUndoStackSize;
    let undoStack = await this.getUndoStack(userId, tableId, windowId);

    undoStack.push(operation);
    if (undoStack.length > this.thresholdConfig.maxUndoStackSize) {
      undoStack = undoStack.slice(-maxUndoStackSize);
    }

    await this.setUndoStack(userId, tableId, windowId, undoStack);

    // Clear redo stack when a new operation is pushed
    await this.cacheService.del(this.redoKey(userId, tableId, windowId));

    this.eventEmitterService.emit(Events.OPERATION_PUSH, operation);
  }

  async mergeLastOperation(
    userId: string,
    tableId: string,
    windowId: string,
    merge: (operation: IUndoRedoOperation) => IUndoRedoOperation | null
  ): Promise<boolean> {
    const undoStack = await this.getUndoStack(userId, tableId, windowId);
    if (!undoStack.length) {
      return false;
    }

    const lastIndex = undoStack.length - 1;
    const merged = merge(undoStack[lastIndex]);
    if (!merged) {
      return false;
    }

    undoStack[lastIndex] = merged;
    await this.setUndoStack(userId, tableId, windowId, undoStack);
    return true;
  }

  async popUndo(tableId: string, windowId: string) {
    const userId = this.cls.get('user.id');
    const undoStack = await this.getUndoStack(userId, tableId, windowId);
    const redoStack = await this.getRedoStack(userId, tableId, windowId);

    const operation = undoStack.pop();

    return {
      operation,
      push: async (newOperation: IUndoRedoOperation) => {
        if (!newOperation) {
          throw new InternalServerErrorException('No operation to undo');
        }
        redoStack.push(newOperation);
        await this.setUndoStack(userId, tableId, windowId, undoStack);
        await this.setRedoStack(userId, tableId, windowId, redoStack);
      },
    };
  }

  async popRedo(tableId: string, windowId: string) {
    const userId = this.cls.get('user.id');
    const undoStack = await this.getUndoStack(userId, tableId, windowId);
    const redoStack = await this.getRedoStack(userId, tableId, windowId);

    const operation = redoStack.pop();

    return {
      operation,
      push: async (newOperation: IUndoRedoOperation) => {
        if (!newOperation) {
          throw new InternalServerErrorException('No operation to redo');
        }
        undoStack.push(newOperation);
        await this.setUndoStack(userId, tableId, windowId, undoStack);
        await this.setRedoStack(userId, tableId, windowId, redoStack);
      },
    };
  }
}
