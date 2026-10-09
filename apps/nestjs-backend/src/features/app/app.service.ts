import { randomUUID } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IAppVo, IAppVersionVo, ICreateAppRo, IUpdateAppRo } from '@teable/openapi';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRenderContext, IRenderOptions } from './templates';
import { getTemplate } from './templates';

/** Layout-only keys of a dashboard component (gridstack position/size). */
const LAYOUT_KEYS = new Set(['x', 'y', 'w', 'h']);

/**
 * True when the only difference between two configs is gridstack layout keys —
 * pure layout adjustments (drag/resize autosave) shouldn't create versions.
 *
 * Keys are SORTED while stripping: the same config legitimately arrives with
 * different key orders — PostgreSQL jsonb canonicalizes on read (shorter keys
 * first) while Zod's validation pipe reorders to the schema's declaration
 * order — and JSON.stringify is key-order sensitive.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isLayoutOnlyChange(prev: unknown, next: unknown): boolean {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((v) => strip(v));
    }
    if (value && typeof value === 'object') {
      const obj: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>)
        .filter((k) => !LAYOUT_KEYS.has(k))
        .sort()) {
        obj[k] = strip((value as Record<string, unknown>)[k]);
      }
      return obj;
    }
    return value;
  };
  return JSON.stringify(strip(prev)) === JSON.stringify(strip(next));
}

@Injectable()
export class AppService {
  constructor(private readonly prismaService: PrismaService) {}

  private toVo(app: {
    id: string;
    baseId: string;
    name: string;
    description: string | null;
    template: string;
    config: unknown;
    version: number;
    createdTime: Date;
    createdBy: string;
    lastModifiedTime: Date;
    lastModifiedBy: string | null;
  }): IAppVo {
    return {
      ...app,
      description: app.description ?? undefined,
      template: app.template as IAppVo['template'],
      config: app.config as IAppVo['config'],
      createdTime: app.createdTime.toISOString(),
      lastModifiedTime: app.lastModifiedTime.toISOString(),
      lastModifiedBy: app.lastModifiedBy ?? undefined,
    };
  }

  private toVersionVo(v: {
    id: string;
    appId: string;
    version: number;
    config: unknown;
    description: string | null;
    createdTime: Date;
    createdBy: string;
  }): IAppVersionVo {
    return {
      ...v,
      config: v.config as IAppVersionVo['config'],
      description: v.description ?? undefined,
      createdTime: v.createdTime.toISOString(),
    };
  }

  async createApp(baseId: string, userId: string, ro: ICreateAppRo): Promise<IAppVo> {
    const id = `app${randomUUID().replace(/-/g, '').slice(0, 17)}`;
    const app = await this.prismaService.txClient().app.create({
      data: {
        id,
        baseId,
        name: ro.name,
        description: ro.description,
        template: ro.template,
        config: ro.config as object,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
    // Create initial version snapshot
    await this.prismaService.txClient().appVersion.create({
      data: {
        appId: id,
        version: 0,
        config: ro.config as object,
        description: 'Initial version',
        createdBy: userId,
      },
    });
    return this.toVo(app);
  }

  async getAppList(baseId: string): Promise<IAppVo[]> {
    const apps = await this.prismaService.txClient().app.findMany({
      where: { baseId, deletedTime: null },
      orderBy: { createdTime: 'asc' },
    });
    return apps.map((a) => this.toVo(a));
  }

  async getApp(baseId: string, appId: string): Promise<IAppVo> {
    const app = await this.prismaService.txClient().app.findFirst({
      where: { id: appId, baseId, deletedTime: null },
    });
    if (!app) throw new NotFoundException(`App ${appId} not found`);
    return this.toVo(app);
  }

  async updateApp(
    baseId: string,
    appId: string,
    userId: string,
    ro: IUpdateAppRo
  ): Promise<IAppVo> {
    const existing = await this.getApp(baseId, appId);
    const data: Record<string, unknown> = { lastModifiedBy: userId };
    if (ro.name !== undefined) data.name = ro.name;
    if (ro.description !== undefined) data.description = ro.description;
    if (ro.config !== undefined) data.config = ro.config;

    // If config changed, snapshot a new version — unless only gridstack layout
    // keys (drag/resize autosave) changed, which isn't a content change.
    let newVersion: number | undefined;
    if (ro.config !== undefined && !isLayoutOnlyChange(existing.config, ro.config)) {
      newVersion = existing.version + 1;
      await this.prismaService.txClient().appVersion.create({
        data: {
          appId,
          version: newVersion,
          config: ro.config as object,
          description: `Version ${newVersion}`,
          createdBy: userId,
        },
      });
      data.version = newVersion;
    }

    // single write keeps the returned VO in sync with the stored version
    const app = await this.prismaService.txClient().app.update({
      where: { id: appId },
      data,
    });
    return this.toVo(app);
  }

  async deleteApp(baseId: string, appId: string): Promise<void> {
    await this.getApp(baseId, appId);
    await this.prismaService.txClient().app.update({
      where: { id: appId },
      data: { deletedTime: new Date() },
    });
  }

  async getVersions(baseId: string, appId: string): Promise<IAppVersionVo[]> {
    await this.getApp(baseId, appId);
    const versions = await this.prismaService.txClient().appVersion.findMany({
      where: { appId },
      orderBy: { version: 'desc' },
    });
    return versions.map((v) => this.toVersionVo(v));
  }

  async rollback(
    baseId: string,
    appId: string,
    userId: string,
    targetVersion: number
  ): Promise<IAppVo> {
    // scope to the base — otherwise an appId from another base could be rolled
    // back by anyone holding app|update on THIS base
    const existing = await this.getApp(baseId, appId);
    const target = await this.prismaService.txClient().appVersion.findUnique({
      where: { appId_version: { appId, version: targetVersion } },
    });
    if (!target) throw new NotFoundException(`Version ${targetVersion} not found`);

    // A rollback is itself a content change: snapshot the restored config as a
    // NEW version. Rewinding app.version instead would collide with existing
    // version rows on the next update (unique [appId, version]).
    const newVersion = existing.version + 1;
    await this.prismaService.txClient().appVersion.create({
      data: {
        appId,
        version: newVersion,
        config: target.config as object,
        description: `Rollback to version ${targetVersion}`,
        createdBy: userId,
      },
    });

    const app = await this.prismaService.txClient().app.update({
      where: { id: appId },
      data: {
        config: target.config as object,
        version: newVersion,
        lastModifiedBy: userId,
      },
    });
    return this.toVo(app);
  }

  async renderApp(
    baseId: string,
    appId: string,
    ctx: IRenderContext,
    options?: IRenderOptions
  ): Promise<string> {
    const app = await this.getApp(baseId, appId);
    const template = getTemplate(app.template);
    return template.render(app.config, ctx, options);
  }
}
