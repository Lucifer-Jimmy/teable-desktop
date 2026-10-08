import { ganttTemplate } from './gantt';
import { dashboardTemplate } from './dashboard';
import { formTemplate } from './form';
import type { IAppTemplate } from './types';

export const APP_TEMPLATES: Record<string, IAppTemplate> = {
  gantt: ganttTemplate,
  dashboard: dashboardTemplate,
  form: formTemplate,
};

export function getTemplate(id: string): IAppTemplate {
  const t = APP_TEMPLATES[id];
  if (!t) throw new Error(`Unknown app template: ${id}`);
  return t;
}

export * from './types';
