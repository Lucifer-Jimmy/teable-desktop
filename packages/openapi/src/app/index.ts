import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import {
  appVoSchema,
  appVersionVoSchema,
  createAppRoSchema,
  updateAppRoSchema,
  rollbackAppRoSchema,
  type IAppVo,
  type IAppVersionVo,
  type ICreateAppRo,
  type IUpdateAppRo,
  type IRollbackAppRo,
} from './types';

// ---------- Create ----------
export const CREATE_APP = '/base/{baseId}/app';

export const CreateAppRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_APP,
  description: 'Create a new app from a template',
  request: {
    params: z.object({ baseId: z.string() }),
    body: { content: { 'application/json': { schema: createAppRoSchema } } },
  },
  responses: {
    201: { description: 'App created', content: { 'application/json': { schema: appVoSchema } } },
  },
  tags: ['app'],
});

export const createApp = async (baseId: string, ro: ICreateAppRo) => {
  return axios.post<IAppVo>(urlBuilder(CREATE_APP, { baseId }), ro);
};

// ---------- List ----------
export const GET_APP_LIST = '/base/{baseId}/app/list';

export const GetAppListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_APP_LIST,
  description: 'List apps in a base',
  request: { params: z.object({ baseId: z.string() }) },
  responses: {
    200: {
      description: 'App list',
      content: { 'application/json': { schema: z.array(appVoSchema) } },
    },
  },
  tags: ['app'],
});

export const getAppList = async (baseId: string) => {
  return axios.get<IAppVo[]>(urlBuilder(GET_APP_LIST, { baseId }));
};

// ---------- Get ----------
export const GET_APP = '/base/{baseId}/app/{appId}';

export const GetAppRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_APP,
  description: 'Get app details with latest version',
  request: {
    params: z.object({ baseId: z.string(), appId: z.string() }),
  },
  responses: {
    200: { description: 'App details', content: { 'application/json': { schema: appVoSchema } } },
  },
  tags: ['app'],
});

export const getApp = async (baseId: string, appId: string) => {
  return axios.get<IAppVo>(urlBuilder(GET_APP, { baseId, appId }));
};

// ---------- Update ----------
export const UPDATE_APP = '/base/{baseId}/app/{appId}';

export const UpdateAppRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_APP,
  description: 'Update app name/description/config',
  request: {
    params: z.object({ baseId: z.string(), appId: z.string() }),
    body: { content: { 'application/json': { schema: updateAppRoSchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: appVoSchema } } },
  },
  tags: ['app'],
});

export const updateApp = async (baseId: string, appId: string, ro: IUpdateAppRo) => {
  return axios.patch<IAppVo>(urlBuilder(UPDATE_APP, { baseId, appId }), ro);
};

// ---------- Delete ----------
export const DELETE_APP = '/base/{baseId}/app/{appId}';

export const DeleteAppRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: DELETE_APP,
  description: 'Soft-delete an app',
  request: {
    params: z.object({ baseId: z.string(), appId: z.string() }),
  },
  responses: { 200: { description: 'Deleted' } },
  tags: ['app'],
});

export const deleteApp = async (baseId: string, appId: string) => {
  return axios.delete<void>(urlBuilder(DELETE_APP, { baseId, appId }));
};

// ---------- Render ----------
export const RENDER_APP = '/base/{baseId}/app/{appId}/render';

export const RenderAppRoute: RouteConfig = registerRoute({
  method: 'get',
  path: RENDER_APP,
  description: 'Render app as full HTML document',
  request: {
    params: z.object({ baseId: z.string(), appId: z.string() }),
  },
  responses: { 200: { description: 'HTML content' } },
  tags: ['app'],
});

// Unlike the axios helpers above, this URL is consumed directly (iframe src /
// window.open), so it must carry the explicit /api prefix the axios instance
// would otherwise add.
export const getAppRenderUrl = (baseId: string, appId: string) =>
  `/api${urlBuilder(RENDER_APP, { baseId, appId })}`;

// ---------- Versions ----------
export const GET_APP_VERSIONS = '/base/{baseId}/app/{appId}/versions';

export const GetAppVersionsRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_APP_VERSIONS,
  description: 'List app version history',
  request: {
    params: z.object({ baseId: z.string(), appId: z.string() }),
  },
  responses: {
    200: {
      description: 'Version list',
      content: { 'application/json': { schema: z.array(appVersionVoSchema) } },
    },
  },
  tags: ['app'],
});

export const getAppVersions = async (baseId: string, appId: string) => {
  return axios.get<IAppVersionVo[]>(urlBuilder(GET_APP_VERSIONS, { baseId, appId }));
};

// ---------- Rollback ----------
export const ROLLBACK_APP = '/base/{baseId}/app/{appId}/rollback';

export const RollbackAppRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ROLLBACK_APP,
  description: 'Rollback app to a specific version',
  request: {
    params: z.object({ baseId: z.string(), appId: z.string() }),
    body: { content: { 'application/json': { schema: rollbackAppRoSchema } } },
  },
  responses: {
    200: { description: 'Rolled back', content: { 'application/json': { schema: appVoSchema } } },
  },
  tags: ['app'],
});

export const rollbackApp = async (baseId: string, appId: string, ro: IRollbackAppRo) => {
  return axios.post<IAppVo>(urlBuilder(ROLLBACK_APP, { baseId, appId }), ro);
};

export * from './types';
