import { z } from 'zod';

export const AppTemplateId = z.enum(['gantt', 'dashboard', 'form']);
export type AppTemplateIdType = z.infer<typeof AppTemplateId>;

export const appTemplateConfigSchema = z.object({
  tableId: z.string().min(1),
  fieldMapping: z.record(z.string(), z.unknown()),
  options: z
    .object({
      theme: z.enum(['light', 'dark']).optional(),
      locale: z.string().optional(),
    })
    .optional(),
});
export type IAppTemplateConfig = z.infer<typeof appTemplateConfigSchema>;

export const appVoSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  template: AppTemplateId,
  config: appTemplateConfigSchema,
  version: z.number().int(),
  createdTime: z.string(),
  createdBy: z.string(),
  lastModifiedTime: z.string(),
  lastModifiedBy: z.string().nullable().optional(),
});
export type IAppVo = z.infer<typeof appVoSchema>;

export const appVersionVoSchema = z.object({
  id: z.string(),
  appId: z.string(),
  version: z.number().int(),
  config: appTemplateConfigSchema,
  description: z.string().nullable().optional(),
  createdTime: z.string(),
  createdBy: z.string(),
});
export type IAppVersionVo = z.infer<typeof appVersionVoSchema>;

export const createAppRoSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  template: AppTemplateId,
  config: appTemplateConfigSchema,
});
export type ICreateAppRo = z.infer<typeof createAppRoSchema>;

export const updateAppRoSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: appTemplateConfigSchema.optional(),
});
export type IUpdateAppRo = z.infer<typeof updateAppRoSchema>;

export const rollbackAppRoSchema = z.object({
  version: z.number().int().min(0),
});
export type IRollbackAppRo = z.infer<typeof rollbackAppRoSchema>;
