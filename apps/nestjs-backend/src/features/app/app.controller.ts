import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
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
    @Query('editable') editable: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    const prisma = this.prismaService.txClient();
    /** Quote a PostgreSQL identifier (double quotes doubled inside). */
    const quoteIdent = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
    /**
     * Resolve a tableId within THIS base. Apps embed tableId in their config;
     * without the baseId filter an app in base A could read tables of base B.
     */
    const resolveTable = async (tableId: string) => {
      const tableMeta = await prisma.tableMeta.findFirst({
        where: { id: tableId, baseId, deletedTime: null },
        select: { dbTableName: true },
      });
      return tableMeta;
    };
    const ctx: IRenderContext = {
      getRecords: async (tableId: string) => {
        const tableMeta = await resolveTable(tableId);
        if (!tableMeta?.dbTableName) return [];
        // dbTableName is "baseId.tableId" — split into schema.table for quoting
        const parts = tableMeta.dbTableName.split('.');
        const qualified =
          parts.length === 2
            ? `${quoteIdent(parts[0])}.${quoteIdent(parts[1])}`
            : quoteIdent(tableMeta.dbTableName);
        const fields = await prisma.field.findMany({
          where: { tableId, deletedTime: null },
          select: { name: true, dbFieldName: true },
        });
        if (!fields.length) return [];
        // Physical columns are named by dbFieldName (a Chinese field name
        // becomes pinyin, e.g. 任务优先级 -> Ren_Wu_You_Xian_Ji) — select them
        // AS the logical field name so templates stay name-based.
        const columns = fields
          .map((f) => `${quoteIdent(f.dbFieldName)} AS ${quoteIdent(f.name)}`)
          .join(', ');
        const rows = await prisma.$queryRawUnsafe(`SELECT ${columns} FROM ${qualified} LIMIT 500`);
        return rows as unknown as Array<Record<string, unknown>>;
      },
      getFields: async (tableId: string) => {
        const tableMeta = await resolveTable(tableId);
        if (!tableMeta) return [];
        const fields = await prisma.field.findMany({
          where: { tableId, deletedTime: null },
          select: { id: true, name: true, type: true, dbFieldName: true, options: true },
        });
        return fields.map(({ options, ...rest }) => ({
          ...rest,
          // options is stored as a JSON string — surface parsed choices so
          // templates can render select inputs
          options: (() => {
            try {
              return options ? (JSON.parse(options) as unknown) : undefined;
            } catch {
              return undefined;
            }
          })(),
        }));
      },
    };
    const html = await this.appService.renderApp(baseId, appId, ctx, {
      // The parent page only appends this flag when the user holds app|update;
      // a forged flag grants nothing — actual layout saves are permission-checked
      // on updateApp in the parent page.
      editable: editable === '1',
    });
    // Helmet's default CSP (script-src 'self') blocks the CDN chart libraries and
    // the inline bootstrap scripts our templates emit. The HTML below is fully
    // server-generated (all user data escaped), so scope the relaxation to this
    // endpoint only: allow jsdelivr assets + inline script/style, keep framing
    // same-origin (the AppPage iframe is same-origin).
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'",
      ].join('; ')
    );
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
