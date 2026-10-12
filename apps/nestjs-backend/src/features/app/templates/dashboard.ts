import type { IAppTemplateConfig } from '@teable/openapi';
import {
  escapeHtml,
  htmlShell,
  type IAppTemplate,
  type IRenderContext,
  type IRenderOptions,
} from './types';

/** Component types users can add to a dashboard canvas. */
export type DashboardComponentType =
  | 'statCard'
  | 'bar'
  | 'horizontalBar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'radar'
  | 'combo'
  | 'funnel'
  | 'progress'
  | 'leaderboard';

export interface IDashboardComponent {
  id: string;
  type: DashboardComponentType;
  title: string;
  /** Target field for the aggregation (empty = all records, for count). */
  field: string;
  agg: 'count' | 'sum' | 'avg' | 'max' | 'min';
  /** Field whose distinct values become chart labels. Charts only. */
  groupBy?: string;
  /** Second series dimension: each distinct value becomes a stacked segment. */
  stackBy?: string;
  /** Scatter: Y-axis field (field is X-axis). Combo: line-series field
   *  (field is the bar series). Progress: optional target field (default 100). */
  field2?: string;
  /** Grid layout (gridstack 12-col units). Server assigns defaults when absent. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** Legacy single-chart config (Phase 1) — auto-migrated to components. */
interface ILegacyDashboardFieldMapping {
  metrics?: Array<{ field: string; agg: string; label: string }>;
  groupBy?: string;
  chartType?: string;
}

interface IDashboardFieldMapping {
  components?: IDashboardComponent[];
}

const AGG_FN: Record<string, (nums: number[]) => number> = {
  count: (n) => n.length,
  sum: (n) => n.reduce((a, b) => a + b, 0),
  avg: (n) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0),
  max: (n) => (n.length ? Math.max(...n) : 0),
  min: (n) => (n.length ? Math.min(...n) : 0),
};

/**
 * Apply an aggregation to a set of records. `count` uses the row count;
 * other aggregations drop null/empty cell values first so they don't drag
 * sums/averages toward zero.
 */
const metricValue = (agg: string, field: string, rows: Array<Record<string, unknown>>): number => {
  if (agg === 'count') return rows.length;
  const nums = rows
    .map((r) => r[field])
    .filter((v) => v != null && v !== '')
    .map(Number)
    .filter(Number.isFinite);
  const value = AGG_FN[agg]?.(nums) ?? 0;
  return Math.round(value * 100) / 100;
};

/** Default gridstack sizes per component type (12-col grid). */
const DEFAULT_SIZE: Record<DashboardComponentType, { w: number; h: number }> = {
  statCard: { w: 3, h: 2 },
  bar: { w: 6, h: 7 },
  horizontalBar: { w: 6, h: 7 },
  line: { w: 6, h: 7 },
  area: { w: 6, h: 7 },
  pie: { w: 4, h: 7 },
  donut: { w: 4, h: 7 },
  scatter: { w: 6, h: 7 },
  radar: { w: 6, h: 7 },
  combo: { w: 8, h: 7 },
  funnel: { w: 6, h: 8 },
  progress: { w: 4, h: 6 },
  leaderboard: { w: 4, h: 8 },
};

/** Migrate Phase-1 metrics config to the multi-component model. */
function migrateLegacy(fm: ILegacyDashboardFieldMapping): IDashboardComponent[] {
  const components: IDashboardComponent[] = (fm.metrics ?? []).map((m, i) => ({
    id: `legacy${i}`,
    type: 'statCard',
    title: m.label || '指标',
    field: m.field,
    agg: (m.agg as IDashboardComponent['agg']) ?? 'count',
  }));
  const first = fm.metrics?.[0];
  if (first && fm.groupBy) {
    components.push({
      id: 'legacyChart',
      type: 'bar',
      title: '分组统计',
      field: first.field,
      agg: (first.agg as IDashboardComponent['agg']) ?? 'count',
      groupBy: fm.groupBy,
    });
  }
  return components;
}

const CHART_JS_TYPE: Record<string, string> = {
  bar: 'bar',
  horizontalBar: 'bar',
  line: 'line',
  area: 'line',
  pie: 'pie',
  donut: 'doughnut',
  scatter: 'scatter',
};

const PALETTE = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#a855f7',
  '#84cc16',
  '#f97316',
  '#14b8a6',
  '#e879f9',
  '#0ea5e9',
  '#65a30d',
];

interface IChartPayload {
  canvasId: string;
  type: string;
  horizontal?: boolean;
  area?: boolean;
  stacked?: boolean;
  /** Combo: dual-axis bar + line; datasets carry a kind discriminator. */
  combo?: boolean;
  /** Funnel: horizontal floating bars; funnelData carries the real values. */
  funnel?: boolean;
  /** Progress ring: single percentage with value/target for the center. */
  progress?: boolean;
  pct?: number;
  value?: number;
  target?: number;
  title: string;
  labels?: string[];
  /** Single-series charts: one entry per label. */
  data?: number[];
  /** Multi-series (stackBy/combo) charts: one dataset per series. */
  datasets?: { label: string; data: number[]; kind?: 'bar' | 'line' }[];
  /** Scatter charts: {x,y} points, optionally per series. */
  points?: { x: number; y: number }[];
  pointSeries?: { label: string; points: { x: number; y: number }[] }[];
  /** Funnel stage data (real value + centered floating-bar bounds). */
  funnelData?: Array<{ name: string; value: number; min: number; max: number }>;
}

export const dashboardTemplate: IAppTemplate = {
  id: 'dashboard',
  name: '仪表盘',
  description: '多组件数据仪表盘：指标卡 + 柱状/条形/折线/面积/饼/环形/散点/堆叠图，可拖拽布局',
  icon: 'bar-chart-3',
  async render(
    config: IAppTemplateConfig,
    ctx: IRenderContext,
    options?: IRenderOptions
  ): Promise<string> {
    const fm = (config.fieldMapping ?? {}) as unknown as IDashboardFieldMapping &
      ILegacyDashboardFieldMapping;
    let components = fm.components ?? [];
    if (!components.length && fm.metrics?.length) {
      components = migrateLegacy(fm);
    }
    if (!components.length) {
      return htmlShell(
        '仪表盘',
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#94a3b8;font-size:14px">请先添加组件（点击右上角 ✏️ 配置按钮）</div>'
      );
    }

    const records = await ctx.getRecords(config.tableId);
    const editable = options?.editable === true;
    // A fully specified layout is user-authored (drag-saved): compact() would
    // reshuffle those positions on every reload, since dragging leaves holes.
    // Only compact while coordinates are still missing (first load / migration
    // from the Phase-1 single-chart config).
    const hasFullLayout = components.every((c) => c.x != null && c.y != null);

    // ---- server-side aggregation per component ----
    const group = (rows: Array<Record<string, unknown>>, key: string) => {
      const map = new Map<string, Array<Record<string, unknown>>>();
      for (const r of rows) {
        const g = String(r[key] ?? '未分组');
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(r);
      }
      return map;
    };

    const payloads: IChartPayload[] = [];
    interface IGridItem {
      comp: IDashboardComponent;
      html: string;
    }
    const items: IGridItem[] = [];
    let chartIndex = 0;

    const chartItemHtml = (id: string, title: string) =>
      `<div class="chart-wrap"><div class="chart-title">${escapeHtml(title)}</div><div class="chart-body"><canvas id="${id}"></canvas></div></div>`;

    for (const comp of components) {
      if (comp.type === 'statCard') {
        const value = metricValue(comp.agg, comp.field, records);
        items.push({
          comp,
          html: `<div class="card"><div class="card-label">${escapeHtml(comp.title)}</div><div class="card-value">${value}</div></div>`,
        });
        continue;
      }

      const canvasId = `chart-${chartIndex++}`;

      if (comp.type === 'leaderboard') {
        // top-10 ranking: pure HTML rows, no chart library involved
        const entries = [...group(records, comp.groupBy ?? '').entries()]
          .map(([k, rows]) => ({ k, v: metricValue(comp.agg, comp.field, rows) }))
          .sort((a, b) => b.v - a.v)
          .slice(0, 10);
        const max = Math.max(...entries.map((e) => e.v), 1);
        const rowsHtml = entries
          .map(
            (e, i) =>
              `<div class="lb-row"><span class="lb-rank${i < 3 ? ' lb-rank-top' : ''}">${i + 1}</span><span class="lb-name" title="${escapeHtml(e.k)}">${escapeHtml(e.k)}</span><span class="lb-bar"><span style="width:${Math.max(2, (e.v / max) * 100)}%"></span></span><span class="lb-val">${e.v}</span></div>`
          )
          .join('');
        items.push({
          comp,
          html: `<div class="chart-wrap"><div class="chart-title">${escapeHtml(comp.title)}</div><div class="lb-list">${rowsHtml}</div></div>`,
        });
        continue;
      }

      if (comp.type === 'progress') {
        // single-value ring: value vs target (default 100 suits percent fields)
        const value = metricValue(comp.agg, comp.field, records);
        const target = comp.field2 ? metricValue(comp.agg, comp.field2, records) : 100;
        const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
        payloads.push({
          canvasId,
          type: 'doughnut',
          progress: true,
          title: comp.title,
          pct,
          value,
          target,
        });
        items.push({ comp, html: chartItemHtml(canvasId, comp.title) });
        continue;
      }

      if (comp.type === 'radar') {
        const radarGroups = group(records, comp.groupBy ?? '');
        const radarLabels = [...radarGroups.keys()].slice(0, 20);
        payloads.push({
          canvasId,
          type: 'radar',
          title: comp.title,
          labels: radarLabels,
          data: radarLabels.map((l) => metricValue(comp.agg, comp.field, radarGroups.get(l)!)),
        });
        items.push({ comp, html: chartItemHtml(canvasId, comp.title) });
        continue;
      }

      if (comp.type === 'combo') {
        // dual axis: bar series (field) + line series (field2) per category
        const comboGroups = group(records, comp.groupBy ?? '');
        const comboLabels = [...comboGroups.keys()].slice(0, 30);
        payloads.push({
          canvasId,
          type: 'bar',
          combo: true,
          title: comp.title,
          labels: comboLabels,
          datasets: [
            {
              label: comp.field || '记录数',
              data: comboLabels.map((l) => metricValue(comp.agg, comp.field, comboGroups.get(l)!)),
              kind: 'bar',
            },
            {
              label: comp.field2 || '数值',
              data: comboLabels.map((l) =>
                metricValue(comp.agg, comp.field2 ?? '', comboGroups.get(l)!)
              ),
              kind: 'line',
            },
          ],
        });
        items.push({ comp, html: chartItemHtml(canvasId, comp.title) });
        continue;
      }

      if (comp.type === 'funnel') {
        // stages sorted by value desc; drawn as centered floating bars whose
        // width is proportional to the largest stage
        const funnelGroups = group(records, comp.groupBy ?? '');
        const entries = [...funnelGroups.entries()]
          .map(([name, rows]) => ({ name, value: metricValue(comp.agg, comp.field, rows) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);
        const max = Math.max(...entries.map((e) => e.value), 1);
        payloads.push({
          canvasId,
          type: 'bar',
          funnel: true,
          title: comp.title,
          labels: entries.map((e) => e.name),
          funnelData: entries.map((e) => ({
            name: e.name,
            value: e.value,
            min: 50 - (e.value / max) * 50,
            max: 50 + (e.value / max) * 50,
          })),
        });
        items.push({ comp, html: chartItemHtml(canvasId, comp.title) });
        continue;
      }

      if (comp.type === 'scatter') {
        // points from two numeric fields; optional groupBy splits colored series.
        // records missing either value are dropped — Number(null) is 0, which
        // would fabricate misleading (0,0) points.
        const hasBoth = (r: Record<string, unknown>) => {
          const x = r[comp.field];
          const y = r[comp.field2 ?? ''];
          return x != null && x !== '' && y != null && y !== '';
        };
        const toPoint = (r: Record<string, unknown>) => ({
          x: Number(r[comp.field]),
          y: Number(r[comp.field2 ?? '']),
        });
        const valid = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y);
        const scatterRecords = records.filter(hasBoth);
        if (comp.groupBy) {
          const series = group(scatterRecords, comp.groupBy);
          const pointSeries = [...series.keys()].slice(0, 12).map((k) => ({
            label: k,
            points: series.get(k)!.map(toPoint).filter(valid),
          }));
          payloads.push({ canvasId, type: 'scatter', title: comp.title, pointSeries });
        } else {
          const points = scatterRecords.map(toPoint).filter(valid);
          payloads.push({ canvasId, type: 'scatter', title: comp.title, points });
        }
        items.push({
          comp,
          html: `<div class="chart-wrap"><div class="chart-title">${escapeHtml(comp.title)}</div><div class="chart-body"><canvas id="${canvasId}"></canvas></div></div>`,
        });
        continue;
      }

      // category charts: labels from groupBy, values from agg+field,
      // optional stackBy splitting each label into stacked segments
      const groups = group(records, comp.groupBy ?? '');
      const labels = [...groups.keys()].slice(0, 30);

      if (comp.stackBy) {
        const stackGroups = group(records, comp.stackBy);
        const stackKeys = [...stackGroups.keys()].slice(0, 12);
        const datasets = stackKeys.map((sk) => ({
          label: sk,
          data: labels.map((l) => {
            const rows = groups.get(l)!.filter((r) => String(r[comp.stackBy!] ?? '未分组') === sk);
            return metricValue(comp.agg, comp.field, rows);
          }),
        }));
        payloads.push({
          canvasId,
          type: CHART_JS_TYPE[comp.type] ?? 'bar',
          horizontal: comp.type === 'horizontalBar',
          stacked: true,
          title: comp.title,
          labels,
          datasets,
        });
      } else {
        payloads.push({
          canvasId,
          type: CHART_JS_TYPE[comp.type] ?? 'bar',
          horizontal: comp.type === 'horizontalBar',
          area: comp.type === 'area',
          title: comp.title,
          labels,
          data: labels.map((l) => metricValue(comp.agg, comp.field, groups.get(l)!)),
        });
      }
      items.push({
        comp,
        html: `<div class="chart-wrap"><div class="chart-title">${escapeHtml(comp.title)}</div><div class="chart-body"><canvas id="${canvasId}"></canvas></div></div>`,
      });
    }

    // ---- gridstack items (12-col grid; x/y optional — gridstack auto-places) ----
    const gridHtml = items
      .map((item) => {
        const size = DEFAULT_SIZE[item.comp.type] ?? DEFAULT_SIZE.bar;
        const w = item.comp.w ?? size.w;
        const h = item.comp.h ?? size.h;
        const pos =
          item.comp.x != null && item.comp.y != null
            ? ` gs-x="${item.comp.x}" gs-y="${item.comp.y}"`
            : '';
        return `<div class="grid-stack-item" gs-id="${escapeHtml(item.comp.id)}" gs-w="${w}" gs-h="${h}"${pos}><div class="grid-stack-item-content">${item.html}</div></div>`;
      })
      .join('');

    const payloadJson = JSON.stringify(payloads);

    return htmlShell(
      '仪表盘',
      `${editable ? '<div class="edit-hint">✋ 拖拽组件调整布局，布局自动保存</div>' : ''}<div class="grid-stack">${gridHtml}</div>`,
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gridstack@11.0.1/dist/gridstack.min.css">
<script src="https://cdn.jsdelivr.net/npm/gridstack@11.0.1/dist/gridstack-all.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
body{padding:16px;background:#f1f5f9;overflow-y:auto}
.edit-hint{font-size:12px;color:#64748b;margin-bottom:8px}
.grid-stack{background:transparent}
.grid-stack-item-content{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);overflow:hidden}
.grid-stack.grid-stack-one-column-mode .grid-stack-item{margin-bottom:8px}
.card{display:flex;flex-direction:column;justify-content:center;height:100%;padding:16px 20px}
.card-label{font-size:13px;color:#64748b;margin-bottom:4px}
.card-value{font-size:28px;font-weight:700;color:#1e293b}
.chart-wrap{display:flex;flex-direction:column;height:100%;padding:16px 20px}
.chart-title{font-size:14px;font-weight:600;color:#334155;margin-bottom:8px;flex-shrink:0}
/* Chart.js requires the canvas to sit alone inside a sized, positioned
   container — its ResizeObserver watches that container to trigger
   chart.resize() when gridstack resizes the block. A bare flex:1 canvas
   only gets bitmap-stretched, never re-laid-out. The canvas is pinned to
   the container with !important so its display box always tracks the
   block during CSS transitions; Chart.js updates the bitmap resolution
   on its (event-driven) resize passes. */
.chart-body{position:relative;flex:1;min-height:0}
.chart-body canvas{position:absolute;top:0;left:0;width:100% !important;height:100% !important}
/* leaderboard rows (pure HTML, no chart library) */
.lb-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
.lb-row{display:flex;align-items:center;gap:8px;min-height:24px}
.lb-rank{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}
.lb-rank-top{background:#6366f1;color:#fff}
.lb-name{flex-shrink:0;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:#334155}
.lb-bar{flex:1;height:6px;border-radius:3px;background:#f1f5f9;overflow:hidden}
.lb-bar span{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#6366f1,#818cf8)}
.lb-val{flex-shrink:0;font-size:13px;font-weight:600;color:#1e293b;font-variant-numeric:tabular-nums}
</style>
<script>
(function(){
  var editable = ${editable ? 'true' : 'false'};
  var hasFullLayout = ${hasFullLayout};
  var charts = ${payloadJson};

  // draw charts first — gridstack resize is picked up by Chart.js's ResizeObserver
  var PALETTE = ${JSON.stringify(PALETTE)};
  function pick(i){ return PALETTE[i % PALETTE.length]; }
  // progress ring: draws the percentage and value/target in the doughnut hole
  var centerTextPlugin = {
    id: 'centerText',
    afterDraw: function (chart) {
      var opts = chart.options.plugins && chart.options.plugins.centerText;
      if (!opts) return;
      var meta = chart.getDatasetMeta(0);
      var arc = meta && meta.data && meta.data[0];
      if (!arc) return;
      var ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1e293b';
      ctx.font = '700 24px Inter, -apple-system, sans-serif';
      ctx.fillText(opts.pct + '%', arc.x, arc.y - 8);
      ctx.fillStyle = '#64748b';
      ctx.font = '400 11px Inter, -apple-system, sans-serif';
      ctx.fillText(opts.value + ' / ' + opts.target, arc.x, arc.y + 14);
      ctx.restore();
    }
  };
  if (window.Chart) {
    charts.forEach(function(c, i){
      var el = document.getElementById(c.canvasId);
      if (!el) return;

      if (c.progress) {
        new Chart(el, {
          type: 'doughnut',
          data: { datasets: [{ data: [c.pct, 100 - c.pct], backgroundColor: ['#6366f1', '#e2e8f0'], borderWidth: 0, cutout: '74%' }] },
          options: {
            responsive: true, maintainAspectRatio: false,
            rotation: -90, circumference: 360,
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false },
              centerText: { pct: c.pct, value: c.value, target: c.target }
            }
          },
          plugins: [centerTextPlugin]
        });
        return;
      }

      var ds;
      var scales;
      var legend;
      var tooltip;
      if (c.funnel) {
        ds = [{
          label: c.title,
          data: c.funnelData.map(function(e){ return [e.min, e.max]; }),
          backgroundColor: c.funnelData.map(function(e, i){ return pick(i); }),
          borderWidth: 0, barPercentage: 0.8
        }];
        scales = { x: { display: false }, y: { reverse: true, grid: { display: false } } };
        legend = false;
        tooltip = { callbacks: { label: function(ctx){ return ' ' + c.funnelData[ctx.dataIndex].value; } } };
      } else if (c.combo && c.datasets) {
        ds = c.datasets.map(function(d){
          if (d.kind === 'line') return { type: 'line', label: d.label, data: d.data, yAxisID: 'y1', borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.15)', tension: 0.3, borderWidth: 2, pointRadius: 3, fill: false };
          return { type: 'bar', label: d.label, data: d.data, yAxisID: 'y', backgroundColor: 'rgba(99,102,241,.75)', borderRadius: 6 };
        });
        scales = { x: {}, y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } };
        legend = true;
      } else if (c.pointSeries) {
        ds = c.pointSeries.map(function(s, si){ return { label: s.label, data: s.points, backgroundColor: pick(si) }; });
        legend = true;
      } else if (c.points) {
        ds = [{ label: c.title, data: c.points, backgroundColor: 'rgba(99,102,241,.6)' }];
        legend = false;
      } else if (c.datasets) {
        ds = c.datasets.map(function(d, si){ return { label: d.label, data: d.data, backgroundColor: pick(si) }; });
        legend = true;
      } else if (c.type === 'radar') {
        ds = [{ label: c.title, data: c.data, backgroundColor: 'rgba(99,102,241,.2)', borderColor: '#6366f1', borderWidth: 2, pointBackgroundColor: '#6366f1', pointRadius: 3 }];
        legend = false;
      } else {
        ds = [{
          label: c.title, data: c.data,
          backgroundColor: (c.type === 'pie' || c.type === 'doughnut') ? PALETTE : (c.area ? 'rgba(99,102,241,.25)' : 'rgba(99,102,241,.75)'),
          borderColor: (c.type === 'line' || c.area) ? '#6366f1' : undefined,
          fill: c.area === true, borderWidth: (c.type === 'line' || c.area) ? 2 : 0,
          borderRadius: c.type === 'bar' ? 6 : 0,
        }];
        legend = c.type === 'pie' || c.type === 'doughnut';
      }
      if (!scales) {
        scales = c.type === 'radar'
          ? { r: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.06)' }, angleLines: { color: 'rgba(0,0,0,.06)' }, pointLabels: { font: { size: 11 } } } }
          : (c.type === 'pie' || c.type === 'doughnut' ? {} : {
              x: { stacked: c.stacked === true },
              y: { stacked: c.stacked === true, beginAtZero: true }
            });
        if (c.horizontal) { scales = { x: scales.y, y: scales.x }; }
      }
      new Chart(el, {
        type: c.type,
        data: { labels: c.labels, datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: c.horizontal ? 'y' : 'x',
          scales: scales,
          plugins: { legend: { display: legend }, tooltip: tooltip }
        }
      });
    });
  }

  if (!window.GridStack) return;
  var grid = GridStack.init({
    column: 12,
    cellHeight: 44,
    margin: 8,
    staticGrid: !editable,
    // no relayout transitions: resize observers then see only the settled
    // size (mid-transition frames caused resize storms that left charts
    // stuck at an intermediate size)
    animate: false,
  }, '.grid-stack');
  if (!hasFullLayout) grid.compact();

  // Chart.js's own resize observer never fires here (its canvas carries a
  // fixed inline size), so re-fit every chart to its block on gridstack
  // layout changes — including this first pass after gridstack has sized
  // the items (charts are created before the grid initializes).
  var resizeCharts = function () {
    if (!window.Chart) return;
    charts.forEach(function (c) {
      var chart = window.Chart.getChart(document.getElementById(c.canvasId));
      if (chart) chart.resize();
    });
  };
  resizeCharts();
  // Live feedback while dragging; the delayed path is unreliable (gridstack
  // animates relayouts with CSS transitions of indeterminate timing), so a
  // ResizeObserver on every chart body watches the settled size directly —
  // it fires on the final layout no matter which path produced the change.
  grid.on('resize', resizeCharts);
  grid.on('change', resizeCharts);
  if (typeof ResizeObserver !== 'undefined') {
    var chartResizeObserver = new ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        var canvas = entry.target.querySelector('canvas');
        var chart = window.Chart && canvas ? window.Chart.getChart(canvas) : null;
        if (chart) chart.resize();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chart-body'), function (el) {
      chartResizeObserver.observe(el);
    });
  }

  if (!editable) return;

  // debounced layout save → parent page (which has permission) persists it
  var saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
      var layout = grid.save(false).map(function(n){
        return { id: String(n.id), x: n.x, y: n.y, w: n.w, h: n.h };
      });
      window.parent.postMessage({ type: 'app-layout-change', layout: layout }, '*');
    }, 800);
  }
  grid.on('change', scheduleSave);
  grid.on('added', scheduleSave);
})();
</script>`
    );
  },
};
