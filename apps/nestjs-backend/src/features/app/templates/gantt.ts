import type { IAppTemplateConfig } from '@teable/openapi';
import { escapeHtml, htmlShell, type IAppTemplate, type IRenderContext } from './types';

interface IGanttFieldMapping {
  title: string;
  startDate: string;
  endDate: string;
  progress?: string;
  assignee?: string;
}

export const ganttTemplate: IAppTemplate = {
  id: 'gantt',
  name: '甘特图',
  description: '基于表数据的时间线甘特图，支持任务进度和负责人展示',
  icon: 'calendar-range',
  async render(config: IAppTemplateConfig, ctx: IRenderContext): Promise<string> {
    const fm = config.fieldMapping as unknown as IGanttFieldMapping;
    const records = await ctx.getRecords(config.tableId);
    // tasks without both dates can't be placed on a timeline — Frappe Gantt
    // renders them as broken/empty bars, so drop them up front
    const tasks = records
      .filter((r) => r[fm.startDate] != null && r[fm.endDate] != null)
      .map((r, i) => ({
        id: `t${i}`,
        name: escapeHtml(r[fm.title] ?? `Task ${i + 1}`),
        start: String(r[fm.startDate]),
        end: String(r[fm.endDate]),
        progress: fm.progress ? Number(r[fm.progress] ?? 0) : 0,
        assignee: fm.assignee ? escapeHtml(r[fm.assignee] ?? '') : '',
      }));

    const tasksJson = JSON.stringify(tasks);

    return htmlShell(
      '甘特图',
      `<div id="gantt"></div>`,
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/frappe-gantt@1.0.0/dist/frappe-gantt.css">
<script src="https://cdn.jsdelivr.net/npm/frappe-gantt@1.0.0/dist/frappe-gantt.umd.js"></script>
<style>
body{padding:20px;background:#fff}
.gantt .bar{fill:#6366f1!important}
.gantt .bar-progress{fill:#4f46e5!important}
.gantt .grid-row{fill:#f8fafc}
.gantt .lower-text,.gantt .upper-text{fill:#64748b;font-size:12px}
</style>
<script>
(function(){
  var tasks = ${tasksJson};
  if(!tasks.length){document.body.innerHTML='<div style="text-align:center;padding:60px;color:#94a3b8">暂无数据</div>';return;}
  new Gantt("#gantt", tasks, {
    view_mode: "Day",
    date_format: "YYYY-MM-DD",
    on_click: function(task){console.log(task);},
  });
})();
</script>`
    );
  },
};
