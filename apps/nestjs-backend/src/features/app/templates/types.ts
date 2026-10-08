import type { z } from 'zod';
import type { IAppTemplateConfig } from '@teable/openapi';

export interface IRenderContext {
  getRecords: (tableId: string) => Promise<Array<Record<string, unknown>>>;
  getFields: (tableId: string) => Promise<Array<{ id: string; name: string; type: string }>>;
}

export interface IAppTemplate {
  id: 'gantt' | 'dashboard' | 'form';
  name: string;
  description: string;
  icon: string;
  render(config: IAppTemplateConfig, ctx: IRenderContext): Promise<string>;
}

export function htmlShell(title: string, body: string, extraHead = ''): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#1e293b}
</style>
${extraHead}
</head>
<body>
${body}
</body>
</html>`;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
