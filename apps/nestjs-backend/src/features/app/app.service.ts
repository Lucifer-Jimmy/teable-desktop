import { randomUUID } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { IAppVo, IAppVersionVo, ICreateAppRo, IUpdateAppRo } from '@teable/openapi';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRenderContext } from './templates';
import { getTemplate } from './templates';

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

    const app = await this.prismaService.txClient().app.update({
      where: { id: appId },
      data,
    });

    // If config changed, snapshot a new version
    if (ro.config !== undefined) {
      const newVersion = existing.version + 1;
      await this.prismaService.txClient().appVersion.create({
        data: {
          appId,
          version: newVersion,
          config: ro.config as object,
          description: `Version ${newVersion}`,
          createdBy: userId,
        },
      });
      await this.prismaService.txClient().app.update({
        where: { id: appId },
        data: { version: newVersion },
      });
    }

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
    const target = await this.prismaService.txClient().appVersion.findUnique({
      where: { appId_version: { appId, version: targetVersion } },
    });
    if (!target) throw new NotFoundException(`Version ${targetVersion} not found`);

    const app = await this.prismaService.txClient().app.update({
      where: { id: appId },
      data: {
        config: target.config as object,
        lastModifiedBy: userId,
      },
    });
    return this.toVo(app);
  }

  async renderApp(baseId: string, appId: string, ctx: IRenderContext): Promise<string> {
    const app = await this.getApp(baseId, appId);
    const template = getTemplate(app.template);
    return template.render(app.config, ctx);
  }
}
