import type { IAppTemplateConfig } from '@teable/openapi';
import { escapeHtml, htmlShell, type IAppTemplate, type IRenderContext } from './types';

interface IDashboardMetric {
  field: string;
  agg: 'count' | 'sum' | 'avg' | 'max' | 'min';
  label: string;
}

interface IDashboardFieldMapping {
  metrics: IDashboardMetric[];
  groupBy?: string;
  chartType?: 'bar' | 'line' | 'pie';
}

const AGG_FN: Record<string, (nums: number[]) => number> = {
  count: (n) => n.length,
  sum: (n) => n.reduce((a, b) => a + b, 0),
  avg: (n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0),
  max: (n) => (n.length ? Math.max(...n) : 0),
  min: (n) => (n.length ? Math.min(...n) : 0),
};

export const dashboardTemplate: IAppTemplate = {
  id: 'dashboard',
  name: '仪表盘',
  description: '数据统计仪表盘，支持多种聚合方式和图表类型',
  icon: 'bar-chart-3',
  async render(config: IAppTemplateConfig, ctx: IRenderContext): Promise<string> {
    const fm = config.fieldMapping as unknown as IDashboardFieldMapping;
    const chartType = fm.chartType ?? 'bar';
    const records = await ctx.getRecords(config.tableId);

    let labels: string[] = [];
    let datasets: { label: string; data: number[] }[] = [];

    if (fm.groupBy) {
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const r of records) {
        const key = String(r[fm.groupBy] ?? '未分组');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      labels = [...groups.keys()];
      datasets = fm.metrics.map((m) => ({
        label: escapeHtml(m.label),
        data: labels.map((k) => {
          const rows = groups.get(k)!;
          const nums = rows.map((r) => Number(r[m.field] ?? 0)).filter(Number.isFinite);
          return Math.round(AGG_FN[m.agg](nums) * 100) / 100;
        }),
      }));
    } else {
      labels = ['总计'];
      datasets = fm.metrics.map((m) => {
        const nums = records.map((r) => Number(r[m.field] ?? 0)).filter(Number.isFinite);
        return {
          label: escapeHtml(m.label),
          data: [Math.round(AGG_FN[m.agg](nums) * 100) / 100],
        };
      });
    }

    const chartData = JSON.stringify({ labels, datasets });
    const chartTypeJs = chartType === 'pie' ? 'pie' : chartType === 'line' ? 'line' : 'bar';

    const cards = fm.metrics
      .map((m, i) => {
        const val = datasets[i]?.data.reduce((a: number, b: number) => Math.max(a, b), 0) ?? 0;
        return `<div class="card"><div class="card-label">${escapeHtml(m.label)}</div><div class="card-value">${val}</div></div>`;
      })
      .join('');

    return htmlShell(
      '仪表盘',
      `<div class="stats">${cards}</div><div class="chart-wrap"><canvas id="chart"></canvas></div>`,
      `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{padding:20px;background:#f1f5f9}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.card{background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card-label{font-size:13px;color:#64748b;margin-bottom:4px}
.card-value{font-size:28px;font-weight:700;color:#1e293b}
.chart-wrap{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
</style>
<script>
(function(){
  var data = ${chartData};
  if(!data.labels.length){document.querySelector('.chart-wrap').innerHTML='<div style="text-align:center;padding:60px;color:#94a3b8">暂无数据</div>';return;}
  new Chart(document.getElementById('chart'), {
    type: '${chartTypeJs}',
    data: data,
    options: { responsive: true, maintainAspectRatio: false }
  });
})();
</script>`
    );
  },
};
