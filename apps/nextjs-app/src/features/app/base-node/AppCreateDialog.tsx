import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IFieldVo } from '@teable/core';
import { createApp, getFields, type IAppVo } from '@teable/openapi';
import { useTables } from '@teable/sdk';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { CalendarRange, BarChart3, ClipboardList, ArrowRight, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';

const TEMPLATES = [
  {
    id: 'gantt' as const,
    name: '甘特图',
    description: '基于表数据的时间线甘特图，展示任务进度和负责人',
    icon: CalendarRange,
    color: 'bg-blue-50 text-blue-600',
  },
  {
    id: 'dashboard' as const,
    name: '仪表盘',
    description: '数据统计仪表盘，支持多种聚合方式和图表类型',
    icon: BarChart3,
    color: 'bg-violet-50 text-violet-600',
  },
  {
    id: 'form' as const,
    name: '动态表单',
    description: '基于表字段生成数据录入表单，提交后写入表记录',
    icon: ClipboardList,
    color: 'bg-emerald-50 text-emerald-600',
  },
];

const FORM_FIELD_TYPES = ['singleLineText', 'number', 'date', 'singleSelect'];

const byType = (fields: IFieldVo[], type: string) => fields.filter((f) => f.type === type);

const ganttMapping = (fields: IFieldVo[]): Record<string, unknown> => {
  const texts = byType(fields, 'singleLineText');
  const dates = byType(fields, 'date');
  const numbers = byType(fields, 'number');
  return {
    title: texts[0]?.name ?? fields[0]?.name ?? '',
    startDate: dates[0]?.name ?? '',
    endDate: dates[1]?.name ?? dates[0]?.name ?? '',
    progress: numbers[0]?.name ?? '',
    assignee: byType(fields, 'singleSelect')[0]?.name ?? '',
  };
};

const dashboardMapping = (fields: IFieldVo[]): Record<string, unknown> => {
  const texts = byType(fields, 'singleLineText');
  const numbers = byType(fields, 'number');
  const components: Array<Record<string, unknown>> = [
    { id: 'c1', type: 'statCard', title: '记录总数', field: '', agg: 'count' },
  ];
  if (numbers[0]) {
    components.push({
      id: 'c2',
      type: 'statCard',
      title: `${numbers[0].name} 合计`,
      field: numbers[0].name,
      agg: 'sum',
    });
  }
  // one grouped bar chart from the first text field (category axis)
  const groupField = texts[0] ?? fields[0];
  if (groupField) {
    components.push({
      id: 'c3',
      type: 'bar',
      title: `按${groupField.name}统计`,
      field: numbers[0]?.name ?? '',
      agg: numbers[0] ? 'sum' : 'count',
      groupBy: groupField.name,
    });
  }
  return { components };
};

/** form input widget per user-inputable field type */
const FORM_INPUT_TYPE: Record<string, string> = {
  number: 'number',
  date: 'date',
  singleSelect: 'select',
};

const formMapping = (fields: IFieldVo[]): Record<string, unknown> => ({
  fields: fields
    .filter((f) => FORM_FIELD_TYPES.includes(f.type))
    .slice(0, 5)
    .map((f) => ({
      field: f.name,
      label: f.name,
      required: false,
      type: FORM_INPUT_TYPE[f.type] ?? 'text',
    })),
  submitLabel: '提交',
});

/**
 * Build the default field mapping for a template from the table's actual fields.
 * Names (not ids) are stored — the render templates query physical columns by field name.
 */
export const buildDefaultMapping = (
  template: 'gantt' | 'dashboard' | 'form',
  fields: IFieldVo[]
): Record<string, unknown> =>
  template === 'gantt'
    ? ganttMapping(fields)
    : template === 'dashboard'
      ? dashboardMapping(fields)
      : formMapping(fields);

interface IAppCreateDialogProps {
  baseId: string;
  open: boolean;
  onClose: () => void;
}

export const AppCreateDialog: React.FC<IAppCreateDialogProps> = ({ baseId, open, onClose }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tables = useTables();
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<'gantt' | 'dashboard' | 'form' | null>(
    null
  );
  const [selectedTableId, setSelectedTableId] = useState('');
  const [appName, setAppName] = useState('');

  // Fetch the selected table's fields so defaults map to real columns
  const { data: fieldsData } = useQuery({
    queryKey: ['app-create-fields', selectedTableId],
    queryFn: () => getFields(selectedTableId).then((res) => res.data),
    enabled: !!selectedTableId,
  });
  const fields = useMemo(() => fieldsData ?? [], [fieldsData]);

  const mappingPreview = useMemo(() => {
    if (!selectedTemplate || !selectedTableId) return null;
    return buildDefaultMapping(selectedTemplate, fields);
  }, [selectedTemplate, selectedTableId, fields]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate || !selectedTableId) throw new Error('Missing selection');
      const config = {
        tableId: selectedTableId,
        fieldMapping: buildDefaultMapping(selectedTemplate, fields),
        options: { theme: 'light' as const },
      };
      const name =
        appName.trim() || TEMPLATES.find((t) => t.id === selectedTemplate)?.name || '未命名应用';
      const res = await createApp(baseId, {
        name,
        template: selectedTemplate,
        config,
      });
      return res.data as IAppVo;
    },
    onSuccess: (app) => {
      onClose();
      // createApp emits no base-node event and creates no base_node row —
      // refresh the sidebar tree so the new app shows up immediately (the
      // node/tree GET reconciles the missing base_node row server-side)
      void queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseNodeTree(baseId) });
      router.push(`/base/${baseId}/app/${app.id}`);
    },
  });

  const reset = () => {
    setStep(0);
    setSelectedTemplate(null);
    setSelectedTableId('');
    setAppName('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === 0 ? '选择模板' : '选择数据表'}</DialogTitle>
        </DialogHeader>

        {step === 0 && (
          <div className="grid gap-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={`flex items-center gap-4 rounded-xl border p-4 text-start transition-colors ${
                  selectedTemplate === t.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  setSelectedTemplate(t.id);
                  setAppName('');
                }}
              >
                <div
                  className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${t.color}`}
                >
                  <t.icon className="size-6" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                应用名称（可选）
              </label>
              <input
                type="text"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                placeholder="留空则使用模板名称"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                选择数据表
              </label>
              <div className="grid gap-2">
                {tables.map((t) => (
                  <button
                    key={t.id}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 text-start text-sm transition-colors ${
                      selectedTableId === t.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                    onClick={() => setSelectedTableId(t.id)}
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t.id.slice(0, 8)}</span>
                  </button>
                ))}
                {tables.length === 0 && (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    当前库中没有数据表，请先创建一个表
                  </div>
                )}
              </div>
            </div>

            {/* Auto-mapping preview from the table's real fields */}
            {selectedTableId && (
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  自动字段映射（创建后可在配置中调整）
                </div>
                {fieldsData === undefined ? (
                  <div className="text-xs text-muted-foreground">加载字段中...</div>
                ) : (
                  <pre className="overflow-auto whitespace-pre-wrap break-all text-xs leading-5 text-muted-foreground">
                    {JSON.stringify(mappingPreview, null, 1)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}

        {createMutation.isError && (
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            创建失败：{createMutation.error.message}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            disabled={createMutation.isPending}
            onClick={() => (step === 0 ? handleClose() : setStep(step - 1))}
          >
            {step === 0 ? (
              '取消'
            ) : (
              <>
                <ArrowLeft className="size-4" /> 上一步
              </>
            )}
          </Button>
          {step === 0 && (
            <Button disabled={!selectedTemplate} onClick={() => setStep(1)}>
              下一步 <ArrowRight className="size-4" />
            </Button>
          )}
          {step === 1 && (
            <Button
              disabled={!selectedTableId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? '创建中...' : '创建应用'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
