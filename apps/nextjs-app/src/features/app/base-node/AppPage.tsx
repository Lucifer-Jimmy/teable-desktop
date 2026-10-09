import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFieldVo } from '@teable/core';
import {
  getApp,
  getAppRenderUrl,
  updateApp,
  deleteApp,
  getAppVersions,
  rollbackApp,
  getFields,
} from '@teable/openapi';
import type { IAppVersionVo, IAppVo, IAppTemplateConfig } from '@teable/openapi';
import { useTables } from '@teable/sdk';
import type { Table } from '@teable/sdk';
import { useBasePermission } from '@teable/sdk/hooks';
import { Button, cn } from '@teable/ui-lib/shadcn';
import {
  CalendarRange,
  BarChart3,
  ClipboardList,
  RefreshCw,
  ExternalLink,
  Pencil,
  X,
  Trash2,
  History,
  RotateCcw,
  Plus,
  Trash2 as TrashIcon,
} from 'lucide-react';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';

const TEMPLATE_META: Record<string, { icon: typeof CalendarRange; label: string }> = {
  gantt: { icon: CalendarRange, label: '甘特图' },
  dashboard: { icon: BarChart3, label: '仪表盘' },
  form: { icon: ClipboardList, label: '动态表单' },
};

export const AppPage: React.FC = () => {
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const slug = router.query.slug as string[];
  const appId = slug?.[1];

  const permission = useBasePermission();
  const canUpdate = !!permission?.['app|update'];
  const canDelete = !!permission?.['app|delete'];
  const tables = useTables();
  const queryClient = useQueryClient();

  const [iframeKey, setIframeKey] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const { data: app, isLoading } = useQuery({
    queryKey: ['app', baseId, appId],
    queryFn: () => getApp(baseId, appId as string).then((res) => res.data),
    enabled: !!baseId && !!appId,
  });

  // Editors get an interactive canvas (gridstack drag/resize); viewers get a
  // static grid. Layout saves from the iframe are permission-checked here.
  const renderUrl = appId
    ? `${getAppRenderUrl(baseId, appId)}${canUpdate ? '?editable=1' : ''}`
    : '';

  // Gridstack in the render iframe posts debounced layout changes; persist
  // them (layout-only changes don't bump the app version — see app.service).
  // No iframe refresh on purpose — the drag interaction must not be reset.
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as
        | {
            type?: string;
            layout?: Array<{ id: string; x: number; y: number; w: number; h: number }>;
          }
        | undefined;
      if (data?.type !== 'app-layout-change' || !data.layout || !appId) return;
      const layout = data.layout;
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      layoutTimer.current = setTimeout(() => {
        void (async () => {
          // Always fetch fresh config — the react-query cache can be stale
          // (e.g. a config saved in another tab), and writing it back would
          // silently revert content changes and bump versions.
          const { data: current } = await getApp(baseId, appId);
          const comps = current?.config?.fieldMapping?.components as
            | IDashboardComponent[]
            | undefined;
          if (!current?.config || !comps?.length) return;
          const layoutMap = new Map(layout.map((l) => [l.id, l]));
          const next = comps.map((c) => {
            const l = layoutMap.get(c.id);
            return l ? { ...c, x: l.x, y: l.y, w: l.w, h: l.h } : c;
          });
          try {
            await updateApp(baseId, appId, {
              config: {
                ...current.config,
                fieldMapping: { ...current.config.fieldMapping, components: next },
              },
            });
          } catch {
            // layout autosave is best-effort; next manual save will retry
          }
        })();
      }, 500);
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
    };
  }, [baseId, appId, queryClient]);

  const refresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const handleNameSave = async () => {
    if (!app || !nameDraft.trim() || nameDraft === app.name) {
      setEditingName(false);
      return;
    }
    await updateApp(baseId, appId as string, { name: nameDraft.trim() });
    setEditingName(false);
    void queryClient.invalidateQueries({ queryKey: ['app', baseId, appId] });
  };

  const handleDelete = async () => {
    if (!appId) return;
    if (!confirm('确定删除此应用？')) return;
    await deleteApp(baseId, appId);
    router.push(`/base/${baseId}`);
  };

  const openInNewTab = () => {
    if (renderUrl) window.open(renderUrl, '_blank');
  };

  if (isLoading || !app) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">加载中...</div>
    );
  }

  const TemplateIcon = TEMPLATE_META[app.template]?.icon ?? BarChart3;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <TemplateIcon className="size-4 text-muted-foreground" />
        {editingName ? (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="rounded border bg-transparent px-2 py-1 text-sm font-medium outline-none"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
          />
        ) : (
          <button
            className={cn('text-sm font-medium', canUpdate && 'cursor-pointer hover:text-primary')}
            onClick={() => {
              if (canUpdate) {
                setNameDraft(app.name);
                setEditingName(true);
              }
            }}
          >
            {app.name}
          </button>
        )}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {TEMPLATE_META[app.template]?.label ?? app.template}
        </span>
        <span className="text-xs text-muted-foreground">v{app.version}</span>

        <div className="flex-1" />

        <Button variant="ghost" size="icon-xs" onClick={refresh} title="刷新">
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={openInNewTab} title="新标签页打开">
          <ExternalLink className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => {
            setShowHistory(!showHistory);
            setShowConfig(false);
          }}
          title="版本历史"
        >
          <History className="size-4" />
        </Button>
        {canUpdate && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setShowConfig(!showConfig);
              setShowHistory(false);
            }}
            title="配置"
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" size="icon-xs" onClick={handleDelete} title="删除">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Iframe */}
        <div className="min-w-0 flex-1 bg-background">
          <iframe
            key={iframeKey}
            src={renderUrl}
            className="size-full border-0"
            title={app.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>

        {/* Config sidebar */}
        {showConfig && canUpdate && app && (
          <AppConfigSidebar
            baseId={baseId}
            appId={appId as string}
            app={app}
            tables={tables}
            onClose={() => setShowConfig(false)}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['app', baseId, appId] });
              refresh();
            }}
          />
        )}

        {/* Version history sidebar */}
        {showHistory && (
          <AppHistorySidebar
            baseId={baseId}
            appId={appId as string}
            currentVersion={app?.version}
            canRollback={canUpdate}
            onClose={() => setShowHistory(false)}
            onRolledBack={() => {
              void queryClient.invalidateQueries({ queryKey: ['app', baseId, appId] });
              void queryClient.invalidateQueries({ queryKey: ['app-versions', baseId, appId] });
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
};

// ============ Config Sidebar ============

interface IDashboardComponent {
  id: string;
  type: 'statCard' | 'bar' | 'horizontalBar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';
  title: string;
  field: string;
  agg: 'count' | 'sum' | 'avg' | 'max' | 'min';
  groupBy?: string;
  stackBy?: string;
  field2?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

const AGG_OPTIONS: Array<{ value: IDashboardComponent['agg']; label: string }> = [
  { value: 'count', label: '计数' },
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '平均' },
  { value: 'max', label: '最大' },
  { value: 'min', label: '最小' },
];

const COMPONENT_TYPES: Array<{ value: IDashboardComponent['type']; label: string }> = [
  { value: 'statCard', label: '指标卡' },
  { value: 'bar', label: '柱状图' },
  { value: 'horizontalBar', label: '条形图' },
  { value: 'line', label: '折线图' },
  { value: 'area', label: '面积图' },
  { value: 'pie', label: '饼图' },
  { value: 'donut', label: '环形图' },
  { value: 'scatter', label: '散点图' },
];

interface IAppConfigSidebarProps {
  baseId: string;
  appId: string;
  app: IAppVo;
  tables: Table[];
  onClose: () => void;
  onSaved: () => void;
}

const AppConfigSidebar: React.FC<IAppConfigSidebarProps> = ({
  baseId,
  appId,
  app,
  tables,
  onClose,
  onSaved,
}) => {
  // Legacy dashboards stored `{metrics: [...]}` (Phase 1 single-chart model).
  // Convert it to the multi-component model on open so the editor sees — and
  // on save persists — the new shape (the render template does the same).
  const [config, setConfig] = useState<IAppTemplateConfig>(() => {
    const fm = app.config.fieldMapping as Record<string, unknown> | undefined;
    if (app.template === 'dashboard' && fm && !fm.components && Array.isArray(fm.metrics)) {
      const metrics = fm.metrics as Array<{ field: string; agg: string; label: string }>;
      return {
        ...app.config,
        fieldMapping: {
          ...fm,
          components: metrics.map((m, i) => ({
            id: `c${i}`,
            type: 'statCard',
            title: m.label || '指标',
            field: m.field,
            agg: m.agg,
          })),
        },
      };
    }
    return app.config;
  });
  const [saving, setSaving] = useState(false);

  // Table objects from useTables do not carry fields — fetch them for the selected table
  const { data: fields } = useQuery({
    queryKey: ['app-config-fields', config.tableId],
    queryFn: () => getFields(config.tableId).then((res) => res.data as IFieldVo[]),
    enabled: !!config.tableId,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      // The sidebar may have been open while the user dragged components in
      // the canvas (layout autosave). Our `config` state holds STALE layout
      // keys — saving it verbatim would revert the canvas. Fetch the fresh
      // config first and graft its layout onto our edited components.
      const { data: fresh } = await getApp(baseId, appId);
      const freshComps = fresh?.config?.fieldMapping?.components as
        | IDashboardComponent[]
        | undefined;
      let configToSave = config;
      if (freshComps?.length) {
        const layoutMap = new Map(freshComps.map((c) => [c.id, c]));
        const editedComponents =
          (config.fieldMapping?.components as IDashboardComponent[] | undefined) ?? [];
        const mergedComponents = editedComponents.map((c) => {
          const latest = layoutMap.get(c.id);
          return latest ? { ...c, x: latest.x, y: latest.y, w: latest.w, h: latest.h } : c;
        });
        configToSave = {
          ...config,
          fieldMapping: { ...config.fieldMapping, components: mergedComponents },
        };
      }
      await updateApp(baseId, appId, { config: configToSave });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleFieldMap = (key: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      fieldMapping: { ...prev.fieldMapping, [key]: value },
    }));
  };

  // Gantt / form templates map named slots to table fields
  const configFields: { key: string; label: string; type: 'field' | 'text' }[] =
    app.template === 'gantt'
      ? [
          { key: 'title', label: '任务名称', type: 'field' },
          { key: 'startDate', label: '开始日期', type: 'field' },
          { key: 'endDate', label: '结束日期', type: 'field' },
          { key: 'progress', label: '进度', type: 'field' },
          { key: 'assignee', label: '负责人', type: 'field' },
        ]
      : app.template === 'form'
        ? [{ key: 'submitLabel', label: '提交按钮文字', type: 'text' }]
        : [];

  // Dashboard template: multi-component canvas (stat cards + chart types)
  const components = (config.fieldMapping?.components as IDashboardComponent[] | undefined) ?? [];
  const setComponents = (next: IDashboardComponent[]) => {
    setConfig((prev) => ({
      ...prev,
      fieldMapping: { ...prev.fieldMapping, components: next },
    }));
  };
  const updateComponent = (id: string, patch: Partial<IDashboardComponent>) => {
    setComponents(components.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeComponent = (id: string) => {
    setComponents(components.filter((c) => c.id !== id));
  };
  const addComponent = (type: IDashboardComponent['type']) => {
    setComponents([
      ...components,
      {
        id: `c${Date.now().toString(36)}`,
        type,
        title: COMPONENT_TYPES.find((t) => t.value === type)?.label ?? '新组件',
        field: '',
        agg: 'count',
        groupBy: type === 'statCard' ? undefined : '',
      },
    ]);
  };
  const fmString = (config.fieldMapping ?? {}) as Record<string, string>;

  return (
    <div className="flex w-80 shrink-0 flex-col border-s bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">应用配置</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {/* Table selection */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">数据表</label>
          <select
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            value={config.tableId}
            onChange={(e) => {
              const nextTableId = e.target.value;
              setConfig((prev) => {
                if (nextTableId === prev.tableId) return prev;
                // field mappings point at the OLD table's fields — clear them
                // per template shape so nothing references columns that don't
                // exist in the new table
                const fm = (prev.fieldMapping ?? {}) as Record<string, unknown>;
                let nextFm: Record<string, unknown>;
                if (app.template === 'gantt') {
                  // every value in a gantt mapping is a field name
                  nextFm = Object.fromEntries(Object.keys(fm).map((k) => [k, '']));
                } else if (app.template === 'form') {
                  nextFm = {
                    ...fm,
                    fields: ((fm.fields as Array<Record<string, unknown>>) ?? []).map((f) => ({
                      ...f,
                      field: '',
                    })),
                  };
                } else {
                  nextFm = {
                    ...fm,
                    components: ((fm.components as Array<Record<string, unknown>>) ?? []).map(
                      (c) => ({ ...c, field: '', field2: '', groupBy: '', stackBy: '' })
                    ),
                  };
                }
                return {
                  ...prev,
                  tableId: nextTableId,
                  fieldMapping: nextFm as IAppTemplateConfig['fieldMapping'],
                };
              });
            }}
          >
            <option value="">选择数据表</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Gantt / form: named field slots */}
        {configFields.map((f) =>
          f.type === 'field' ? (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {f.label}
              </label>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={fmString[f.key] ?? ''}
                onChange={(e) => handleFieldMap(f.key, e.target.value)}
              >
                <option value="">选择字段</option>
                {(fields ?? []).map((field) => (
                  <option key={field.id} value={field.name}>
                    {field.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {f.label}
              </label>
              <input
                type="text"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={fmString[f.key] ?? ''}
                onChange={(e) => handleFieldMap(f.key, e.target.value)}
              />
            </div>
          )
        )}

        {/* Dashboard: multi-component canvas editor */}
        {app.template === 'dashboard' && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                组件（{components.length}）
              </label>
              <div className="space-y-2">
                {components.map((c) => (
                  <div key={c.id} className="space-y-1.5 rounded-lg border p-2">
                    <div className="flex items-center gap-1.5">
                      <select
                        className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-xs"
                        value={c.type}
                        onChange={(e) => {
                          const type = e.target.value as IDashboardComponent['type'];
                          updateComponent(c.id, {
                            type,
                            groupBy: type === 'statCard' ? undefined : c.groupBy ?? '',
                          });
                        }}
                      >
                        {COMPONENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground"
                        onClick={() => removeComponent(c.id)}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                    <input
                      type="text"
                      className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs"
                      placeholder="组件标题"
                      value={c.title}
                      onChange={(e) => updateComponent(c.id, { title: e.target.value })}
                    />
                    <div className="flex items-center gap-1.5">
                      <select
                        className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 text-xs"
                        value={c.field}
                        onChange={(e) => updateComponent(c.id, { field: e.target.value })}
                      >
                        <option value="">全部记录</option>
                        {(fields ?? []).map((field) => (
                          <option key={field.id} value={field.name}>
                            {field.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="rounded-md border bg-transparent px-2 py-1.5 text-xs"
                        value={c.agg}
                        onChange={(e) =>
                          updateComponent(c.id, {
                            agg: e.target.value as IDashboardComponent['agg'],
                          })
                        }
                      >
                        {AGG_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {c.type !== 'statCard' && (
                      <select
                        className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs"
                        value={c.groupBy ?? ''}
                        onChange={(e) => updateComponent(c.id, { groupBy: e.target.value })}
                      >
                        <option value="">分组字段（选择后按组统计）</option>
                        {(fields ?? []).map((field) => (
                          <option key={field.id} value={field.name}>
                            {field.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {c.type === 'scatter' && (
                      <select
                        className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs"
                        value={c.field2 ?? ''}
                        onChange={(e) => updateComponent(c.id, { field2: e.target.value })}
                      >
                        <option value="">Y 轴字段（必选）</option>
                        {(fields ?? []).map((field) => (
                          <option key={field.id} value={field.name}>
                            {field.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {['bar', 'horizontalBar', 'line', 'area'].includes(c.type) && (
                      <select
                        className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs"
                        value={c.stackBy ?? ''}
                        onChange={(e) => updateComponent(c.id, { stackBy: e.target.value })}
                      >
                        <option value="">堆叠字段（可选，按此字段分段堆叠）</option>
                        {(fields ?? []).map((field) => (
                          <option key={field.id} value={field.name}>
                            {field.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="xs"
                  className="w-full"
                  onClick={() => addComponent('statCard')}
                >
                  <Plus className="size-3.5" /> 添加指标卡
                </Button>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    ['bar', 'horizontalBar', 'line', 'area', 'pie', 'donut', 'scatter'] as const
                  ).map((type) => (
                    <Button
                      key={type}
                      variant="outline"
                      size="xs"
                      onClick={() => addComponent(type)}
                    >
                      <Plus className="size-3" />
                      {COMPONENT_TYPES.find((t) => t.value === type)?.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="border-t p-4">
        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </Button>
      </div>
    </div>
  );
};

// ============ Version History Sidebar ============
interface IAppHistorySidebarProps {
  baseId: string;
  appId: string;
  currentVersion: number | undefined;
  canRollback: boolean;
  onClose: () => void;
  onRolledBack: () => void;
}

const AppHistorySidebar: React.FC<IAppHistorySidebarProps> = ({
  baseId,
  appId,
  currentVersion,
  canRollback,
  onClose,
  onRolledBack,
}) => {
  const queryClient = useQueryClient();
  const { data: versions, isLoading } = useQuery({
    queryKey: ['app-versions', baseId, appId],
    queryFn: () => getAppVersions(baseId, appId).then((res) => res.data as IAppVersionVo[]),
    enabled: !!baseId && !!appId,
  });

  const rollbackMutation = useMutation({
    mutationFn: (version: number) => rollbackApp(baseId, appId, { version }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['app', baseId, appId] });
      onRolledBack();
    },
  });

  return (
    <div className="flex w-80 shrink-0 flex-col border-s bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">版本历史</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-4">
        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        )}
        {versions?.map((v) => {
          const isCurrent = v.version === currentVersion;
          return (
            <div
              key={v.version}
              className={cn('rounded-lg border p-3', isCurrent && 'border-primary bg-primary/5')}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">v{v.version}</span>
                {isCurrent ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    当前
                  </span>
                ) : (
                  canRollback && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-6 gap-1 px-2 text-xs"
                      disabled={rollbackMutation.isPending}
                      onClick={() => rollbackMutation.mutate(v.version)}
                    >
                      <RotateCcw className="size-3" />
                      回滚
                    </Button>
                  )
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{v.description}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {new Date(v.createdTime).toLocaleString()}
              </div>
            </div>
          );
        })}
        {versions && versions.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无版本记录</div>
        )}
        {rollbackMutation.isError && (
          <div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            回滚失败：{rollbackMutation.error.message}
          </div>
        )}
      </div>
    </div>
  );
};
