import {
  getApp,
  getAppRenderUrl,
  updateApp,
  deleteApp,
} from '@teable/openapi';
import { useBasePermission } from '@teable/sdk/hooks';
import { useTables } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarRange,
  BarChart3,
  ClipboardList,
  Monitor,
  Tablet,
  Smartphone,
  RefreshCw,
  ExternalLink,
  Pencil,
  X,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';

const DEVICE_MODES = [
  { id: 'desktop', label: '桌面', icon: Monitor, width: '100%' },
  { id: 'tablet', label: '平板', icon: Tablet, width: '768px' },
  { id: 'mobile', label: '手机', icon: Smartphone, width: '390px' },
] as const;

const TEMPLATE_META: Record<string, { icon: typeof CalendarRange; label: string }> = {
  gantt: { icon: CalendarRange, label: '甘特图' },
  dashboard: { icon: BarChart3, label: '仪表盘' },
  form: { icon: ClipboardList, label: '动态表单' },
};

type DeviceMode = (typeof DEVICE_MODES)[number]['id'];

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

  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const { data: app, isLoading } = useQuery({
    queryKey: ['app', baseId, appId],
    queryFn: () => getApp(baseId, appId as string).then((res) => res.data),
    enabled: !!baseId && !!appId,
  });

  const renderUrl = appId ? getAppRenderUrl(baseId, appId) : '';

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
      <div className="flex h-full items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  const TemplateIcon = TEMPLATE_META[app.template]?.icon ?? BarChart3;
  const mode = DEVICE_MODES.find((m) => m.id === device) ?? DEVICE_MODES[0];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <TemplateIcon className="size-4 text-muted-foreground" />
        {editingName ? (
          <input
            autoFocus
            className="rounded border bg-transparent px-2 py-1 text-sm font-medium outline-none"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
          />
        ) : (
          <button
            className={cn(
              'text-sm font-medium',
              canUpdate && 'cursor-pointer hover:text-primary'
            )}
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

        {/* Device toggle */}
        <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          {DEVICE_MODES.map((m) => (
            <button
              key={m.id}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                device === m.id
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setDevice(m.id)}
            >
              <m.icon className="size-3.5" />
              <span className="hidden md:inline">{m.label}</span>
            </button>
          ))}
        </div>

        <Button variant="ghost" size="icon-xs" onClick={refresh} title="刷新">
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={openInNewTab} title="新标签页打开">
          <ExternalLink className="size-4" />
        </Button>
        {canUpdate && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowConfig(!showConfig)}
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
        <div className="flex flex-1 items-start justify-center overflow-auto bg-muted/50">
          <div
            className="h-full bg-background shadow-lg transition-all"
            style={{ width: mode.width, maxWidth: '100%' }}
          >
            <iframe
              key={iframeKey}
              src={renderUrl}
              className="h-full w-full border-0"
              title={app.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
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
      </div>
    </div>
  );
};

// ============ Config Sidebar ============
import type { IAppVo, IAppTemplateConfig } from '@teable/openapi';

interface IAppConfigSidebarProps {
  baseId: string;
  appId: string;
  app: IAppVo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: any[];
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
  const [config, setConfig] = useState<IAppTemplateConfig>(app.config);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateApp(baseId, appId, { config });
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

  const selectedTable = tables.find((t) => t.id === config.tableId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields = (selectedTable?.fields as any[]) ?? [];

  // Define config fields based on template
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

  return (
    <div className="flex w-80 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">应用配置</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            数据表
          </label>
          <select
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            value={config.tableId}
            onChange={(e) => setConfig((prev) => ({ ...prev, tableId: e.target.value }))}
          >
            <option value="">选择数据表</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {configFields.map((f) =>
          f.type === 'field' ? (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {f.label}
              </label>
              <select
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={(config.fieldMapping as Record<string, string>)[f.key] ?? ''}
                onChange={(e) => handleFieldMap(f.key, e.target.value)}
              >
                <option value="">选择字段</option>
                {fields.map((field) => (
                  <option key={field.id ?? field.name} value={field.name}>
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
                value={(config.fieldMapping as Record<string, string>)[f.key] ?? ''}
                onChange={(e) => handleFieldMap(f.key, e.target.value)}
              />
            </div>
          )
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
