import { createApp, type IAppVo } from '@teable/openapi';
import { useTables } from '@teable/sdk';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useMutation } from '@tanstack/react-query';
import { CalendarRange, BarChart3, ClipboardList, ArrowRight, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/router';
import { useState } from 'react';

const TEMPLATES = [
  {
    id: 'gantt' as 'gantt' | 'dashboard' | 'form',
    name: '甘特图',
    description: '基于表数据的时间线甘特图，展示任务进度和负责人',
    icon: CalendarRange,
    color: 'bg-blue-50 text-blue-600',
  },
  {
    id: 'dashboard' as 'gantt' | 'dashboard' | 'form',
    name: '仪表盘',
    description: '数据统计仪表盘，支持多种聚合方式和图表类型',
    icon: BarChart3,
    color: 'bg-violet-50 text-violet-600',
  },
  {
    id: 'form' as 'gantt' | 'dashboard' | 'form',
    name: '动态表单',
    description: '基于表字段生成数据录入表单，提交后写入表记录',
    icon: ClipboardList,
    color: 'bg-emerald-50 text-emerald-600',
  },
];

interface IAppCreateDialogProps {
  baseId: string;
  open: boolean;
  onClose: () => void;
}

export const AppCreateDialog: React.FC<IAppCreateDialogProps> = ({
  baseId,
  open,
  onClose,
}) => {
  const router = useRouter();
  const tables = useTables();
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<'gantt' | 'dashboard' | 'form' | null>(null);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [appName, setAppName] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate || !selectedTableId) throw new Error('Missing selection');
      const table = tables.find((t: { id: string }) => t.id === selectedTableId);
      const fields: Array<{ name: string; type: string }> = []; // Fields fetched at render time

      // Build default field mapping based on template + available fields
      const fieldNames = fields.map((f) => f.name);
      const defaultMapping: Record<string, string> = {};

      if (selectedTemplate === 'gantt') {
        defaultMapping.title = fieldNames[0] ?? '';
        const dateField = fields.find((f) => f.type === 'date');
        defaultMapping.startDate = dateField?.name ?? fieldNames[1] ?? '';
        defaultMapping.endDate = fields.find((f) => f.type === 'date' && f.name !== defaultMapping.startDate)?.name ?? dateField?.name ?? '';
        const numField = fields.find((f) => f.type === 'number');
        defaultMapping.progress = numField?.name ?? '';
      } else if (selectedTemplate === 'dashboard') {
        // Default: count all records + sum of first number field
        defaultMapping.metrics = [
          { field: '', agg: 'count', label: '记录总数' },
        ];
        const numField = fields.find((f) => f.type === 'number');
        if (numField) {
          defaultMapping.metrics.push({ field: numField.name, agg: 'sum', label: numField.name + ' 合计' });
        }
        defaultMapping.chartType = 'bar';
      } else if (selectedTemplate === 'form') {
        // Default: all text/number/date fields become form inputs
        defaultMapping.fields = fields
          .filter((f) => ['singleLineText', 'number', 'date', 'singleSelect'].includes(f.type))
          .slice(0, 5)
          .map((f) => ({ field: f.name, label: f.name, required: false, type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'singleSelect' ? 'select' : 'text' }));
        defaultMapping.submitLabel = '提交';
      }

      const config = {
        tableId: selectedTableId,
        fieldMapping: defaultMapping,
        options: { theme: 'light' as const },
      };

      const name = appName.trim() || TEMPLATES.find((t) => t.id === selectedTemplate)?.name || '未命名应用';
      const res = await createApp(baseId, {
        name,
        template: selectedTemplate,
        config,
      });
      return res.data as IAppVo;
    },
    onSuccess: (app) => {
      onClose();
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

  const canNext = step === 0 ? !!selectedTemplate : !!selectedTableId;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 0 ? '选择模板' : step === 1 ? '选择数据表' : '创建应用'}
          </DialogTitle>
        </DialogHeader>

        {step === 0 && (
          <div className="grid gap-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                  selectedTemplate === t.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  setSelectedTemplate(t.id);
                  setAppName('');
                }}
              >
                <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${t.color}`}>
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
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                      selectedTableId === t.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
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
          </div>
        )}

        {step === 2 && createMutation.isPending && (
          <div className="flex items-center justify-center gap-2 py-8">
            <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">正在创建应用...</span>
          </div>
        )}

        {step === 2 && createMutation.isError && (
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            创建失败：{createMutation.error.message}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? handleClose() : setStep(step - 1))}
          >
            {step === 0 ? '取消' : <><ArrowLeft className="size-4" /> 上一步</>}
          </Button>
          {step < 2 && (
            <Button
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
            >
              下一步 <ArrowRight className="size-4" />
            </Button>
          )}
          {step === 1 && (
            <Button
              disabled={!selectedTableId || createMutation.isPending}
              onClick={() => {
                setStep(2);
                createMutation.mutate();
              }}
            >
              创建应用
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
