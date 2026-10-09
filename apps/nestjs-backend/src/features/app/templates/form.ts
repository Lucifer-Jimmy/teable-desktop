import type { IAppTemplateConfig } from '@teable/openapi';
import { escapeHtml, htmlShell, type IAppTemplate, type IRenderContext } from './types';

interface IFormField {
  field: string;
  label: string;
  required: boolean;
  type: 'text' | 'number' | 'date' | 'select';
  options?: string[];
}

interface IFormFieldMapping {
  fields: IFormField[];
  submitLabel?: string;
}

export const formTemplate: IAppTemplate = {
  id: 'form',
  name: '动态表单',
  description: '基于表字段生成数据录入表单，提交后写入表记录',
  icon: 'clipboard-list',
  async render(config: IAppTemplateConfig, ctx: IRenderContext): Promise<string> {
    const fm = config.fieldMapping as unknown as IFormFieldMapping;
    const fields = ctx ? await ctx.getFields(config.tableId) : [];
    const fieldMap = new Map(fields.map((f) => [f.name, f]));

    const formFields = fm.fields
      .map((f) => {
        const field = fieldMap.get(f.field);
        const requiredAttr = f.required ? 'required' : '';
        const label = escapeHtml(f.label || f.field);

        // select inputs: prefer the underlying singleSelect field's own choices
        // (config-level options are rarely populated); fall back to config options
        const selectChoices =
          field?.type === 'singleSelect'
            ? (((field.options as { choices?: Array<{ name: string }> })?.choices ?? [])
                .map((c) => c.name)
                .filter(Boolean) as string[])
            : f.options ?? [];

        if (f.type === 'select' && selectChoices.length) {
          const opts = selectChoices
            .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
            .join('');
          return `<div class="form-field"><label>${label}${f.required ? '<span class="req">*</span>' : ''}</label><select name="${escapeHtml(f.field)}" ${requiredAttr}><option value="">请选择</option>${opts}</select></div>`;
        }

        // a singleSelect field without resolvable choices must NOT become a
        // free-text input — arbitrary text would fail record validation
        if (field?.type === 'singleSelect') {
          return `<div class="form-field"><label>${label}</label><div class="field-hint">此字段暂无可选项</div></div>`;
        }

        const inputType = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
        return `<div class="form-field"><label>${label}${f.required ? '<span class="req">*</span>' : ''}</label><input type="${inputType}" name="${escapeHtml(f.field)}" ${requiredAttr} placeholder="请输入${label}"></div>`;
      })
      .join('');

    const submitLabel = escapeHtml(fm.submitLabel || '提交');
    const tableId = escapeHtml(config.tableId);
    const apiBase = '/api/table/' + tableId + '/record';

    return htmlShell(
      '动态表单',
      `<div class="form-container"><h2>数据录入</h2><form id="dataForm">${formFields}<button type="submit" class="submit-btn">${submitLabel}</button></form><div id="msg" class="msg"></div></div>`,
      `<style>
body{display:flex;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}
.form-container{background:#fff;border-radius:16px;padding:32px;width:100%;max-width:480px;margin:40px 20px;box-shadow:0 20px 60px rgba(0,0,0,.15)}
h2{margin-bottom:24px;font-size:20px;color:#1e293b}
.form-field{margin-bottom:16px}
.form-field label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px}
.req{color:#ef4444;margin-left:2px}
.form-field input,.form-field select{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;outline:none;transition:border-color .2s}
.field-hint{padding:10px 12px;border:1px dashed #e2e8f0;border-radius:8px;font-size:13px;color:#94a3b8}
.form-field input:focus,.form-field select:focus{border-color:#6366f1}
.submit-btn{width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s}
.submit-btn:hover{background:#4f46e5}
.submit-btn:disabled{background:#94a3b8;cursor:not-allowed}
.msg{text-align:center;margin-top:12px;font-size:14px;min-height:20px}
.msg.ok{color:#16a34a}
.msg.err{color:#ef4444}
</style>
<script>
(function(){
  var form = document.getElementById('dataForm');
  var msg = document.getElementById('msg');
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var btn = form.querySelector('.submit-btn');
    btn.disabled = true; btn.textContent = '提交中...';
    msg.className = 'msg'; msg.textContent = '';
    var data = { records: [{ fields: {} }] };
    new FormData(form).forEach(function(val, key){
      var el = form.querySelector('[name="' + key + '"]');
      var type = el ? el.type : 'text';
      // FormData values are always strings — cast per input type, and pass
      // null for empties so the API doesn't reject them as invalid values.
      if (val === '' && (type === 'number' || type === 'date')) {
        return;
      }
      data.records[0].fields[key] = type === 'number' ? Number(val) : val;
    });
    fetch('${apiBase}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(data),
    })
    .then(function(r) { return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
    .then(function(res) {
      if(res.ok) {
        msg.className = 'msg ok'; msg.textContent = '提交成功！';
        form.reset();
      } else {
        msg.className = 'msg err';
        msg.textContent = (res.body && res.body.message) || '提交失败，请重试';
      }
    })
    .catch(function() {
      msg.className = 'msg err'; msg.textContent = '网络错误，请重试';
    })
    .finally(function() {
      btn.disabled = false; btn.textContent = '${submitLabel}';
    });
  });
})();
</script>`
    );
  },
};
