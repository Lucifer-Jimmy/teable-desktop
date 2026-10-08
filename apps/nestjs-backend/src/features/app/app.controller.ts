import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  createAppRoSchema,
  updateAppRoSchema,
  rollbackAppRoSchema,
  type IAppVo,
  type IAppVersionVo,
  type ICreateAppRo,
  type IUpdateAppRo,
  type IRollbackAppRo,
} from '@teable/openapi';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import type { IClsStore } from '../../types/cls';
import { AppService } from './app.service';
import type { IRenderContext } from './templates';

@Controller('api/base/:baseId/app')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Permissions('app|create')
  @Post()
  async createApp(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(createAppRoSchema)) ro: ICreateAppRo
  ): Promise<IAppVo> {
    const userId = this.cls.get('user.id');
    return this.appService.createApp(baseId, userId, ro);
  }

  @Permissions('app|read')
  @Get('list')
  async getAppList(@Param('baseId') baseId: string): Promise<IAppVo[]> {
    return this.appService.getAppList(baseId);
  }

  @Permissions('app|read')
  @Get(':appId')
  async getApp(@Param('baseId') baseId: string, @Param('appId') appId: string): Promise<IAppVo> {
    return this.appService.getApp(baseId, appId);
  }

  @Permissions('app|update')
  @Patch(':appId')
  async updateApp(
    @Param('baseId') baseId: string,
    @Param('appId') appId: string,
    @Body(new ZodValidationPipe(updateAppRoSchema)) ro: IUpdateAppRo
  ): Promise<IAppVo> {
    const userId = this.cls.get('user.id');
    return this.appService.updateApp(baseId, appId, userId, ro);
  }

  @Permissions('app|delete')
  @Delete(':appId')
  async deleteApp(@Param('baseId') baseId: string, @Param('appId') appId: string): Promise<void> {
    return this.appService.deleteApp(baseId, appId);
  }

  @Permissions('app|read')
  @Get(':appId/render')
  async renderApp(
    @Param('baseId') baseId: string,
    @Param('appId') appId: string,
    @Res() res: Response
  ): Promise<void> {
    const prisma = this.prismaService.txClient();
    const ctx: IRenderContext = {
      getRecords: async (tableId: string) => {
        // Look up the physical table name (dbTableName) — it differs from the table ID
        const tableMeta = await prisma.tableMeta.findFirst({
          where: { id: tableId, deletedTime: null },
          select: { dbTableName: true },
        });
        if (!tableMeta?.dbTableName) return [];
        // dbTableName is "baseId.tableId" — split into schema.table for quoting
        const parts = tableMeta.dbTableName.split('.');
        const qualified =
          parts.length === 2 ? `"${parts[0]}"."${parts[1]}"` : `"${tableMeta.dbTableName}"`;
        const fields = await prisma.field.findMany({
          where: { tableId, deletedTime: null },
          select: { name: true },
        });
        const fieldNames = fields.map((f) => `"${f.name}"`).join(', ');
        if (!fieldNames) return [];
        const rows = await prisma.$queryRawUnsafe(
          `SELECT ${fieldNames} FROM ${qualified} LIMIT 500`
        );
        return rows as unknown as Array<Record<string, unknown>>;
      },
      getFields: async (tableId: string) => {
        return prisma.field.findMany({
          where: { tableId, deletedTime: null },
          select: { id: true, name: true, type: true },
        });
      },
    };
    const html = await this.appService.renderApp(baseId, appId, ctx);
    res.type('text/html').send(html);
  }

  @Permissions('app|read')
  @Get(':appId/versions')
  async getVersions(
    @Param('baseId') baseId: string,
    @Param('appId') appId: string
  ): Promise<IAppVersionVo[]> {
    return this.appService.getVersions(baseId, appId);
  }

  @Permissions('app|update')
  @Post(':appId/rollback')
  async rollback(
    @Param('baseId') baseId: string,
    @Param('appId') appId: string,
    @Body(new ZodValidationPipe(rollbackAppRoSchema)) ro: IRollbackAppRo
  ): Promise<IAppVo> {
    const userId = this.cls.get('user.id');
    return this.appService.rollback(baseId, appId, userId, ro.version);
  }
}
