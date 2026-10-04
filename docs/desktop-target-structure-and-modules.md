# Teable 桌面版 · 目标目录结构与模块开发顺序
> 生成时间：2026-10-03 ｜ 姊妹篇：`teable-desktop-analysis.md`（功能地图）、`desktop-rewrite-roadmap.md`（阶段路线）
> 本文是执行蓝图：**① 改造完成后的目录长什么样；② 每个模块的开发顺序、依赖、验收标准。**

---

## 0. 两条结构设计原则

1. **冻结区不动、手术区重构**：`apps/nextjs-app`、`packages/sdk|ui-lib|openapi|core|formula|common-i18n` 的文件**位置与导出都不变**（前端零改动的保证）。大改只发生在 `apps/nestjs-backend/src/**`（换内脏）和新增的 `apps/desktop/`（桌面壳）。
2. **增量对齐终态，不做大爆炸搬迁**：目标树是"北极星"。每个阶段完成时，被改动/删除的目录顺手挪到终态位置（目录级移动 + 修 import，一次切片十几分钟），**不要**专门花一周做全仓库搬家。

---

## 1. 目标目录结构（终态）

```
teable/
├── apps/
│   ├── desktop/                          ★ 新增 · Electron 桌面壳（阶段 9）
│   │   ├── src/main/                     │   主进程：拉起 host、窗口、托盘、单实例、自动更新
│   │   ├── src/preload/                  │   contextBridge：文件对话框/系统能力的安全暴露
│   │   ├── src/renderer-bridge/          │   开发/生产两种加载方式（dev 连热更新端口）
│   │   ├── assets/                       │   图标、安装包资源
│   │   ├── electron-builder.yml          │   打包配置（win/mac）
│   │   └── package.json                  │   @teable/desktop
│   │
│   ├── nestjs-backend/                   🔪 手术区 · 瘦身为「host 宿主层」（名字保留，内脏全换）
│   │   └── src/
│   │       ├── api/                      ★ 薄 REST 控制器（URL/DTO 冻结不变）
│   │       │   ├── table/  field/  record/  view/  aggregation/
│   │       │   ├── selection/  import/  export/  undo/  trash/  attachment/
│   │       │   └── (每个文件 ≈ 原 features/*/open-api/*.controller.ts 平移)
│   │       ├── kernel/                   ★ v2 内核装配（原 features/v2/v2-container.service.ts）
│   │       │   ├── container.ts          │   pglite/pg + realtime + undo 的组合根注册
│   │       │   ├── bridge/               │   openapi DTO ↔ v2 command/query 映射
│   │       │   └── compat/               │   v2 事件 → ShareDB 旧 op 形状（喂前端）
│   │       ├── realtime/                 ★ ShareDB + WS（原 src/share-db/ + src/ws/ 收拢）
│   │       │   └── sharedb/              │   协议不变，后端逐步只读 v2 事件
│   │       ├── modules/                  ◐ 保留的宿主功能（桌面需要的那几块）
│   │       │   ├── attachment/           │   本地磁盘存储 + 缩略图（原 features/attachments 瘦身）
│   │       │   ├── file-io/              │   CSV 导入/导出、剪贴板序列化（原 import+export+selection 合并）
│   │       │   ├── trash/                │   回收站
│   │       │   ├── settings/             │   实例设置（本地化）
│   │       │   ├── user-stub/            │   单用户桩（createdBy 等归属字段用）
│   │       │   └── pin/                  │   收藏/最近访问
│   │       ├── infra/                    ◐ 基础设施（全本地化）
│   │       │   ├── cache/                │   sqlite/memory（原 src/cache/）
│   │       │   ├── queue/                │   进程内本地队列（原 event-job/fallback）
│   │       │   ├── storage/              │   本地文件（原 attachments/plugins/local）
│   │       │   └── logger/               │   console/pino
│   │       ├── shared/                   │   config、utils、异常过滤
│   │       └── main.ts                   │   启动：迁移 → 建内核 → 挂 API/WS
│   │
│   └── nextjs-app/                       🧊 冻结 · 前端（样式零改动）
│       └── src/features/app/**           │   blocks/components 全部原样保留
│
├── packages/                             🧊 共享层（冻结）＋ ★ 内核层（主战场）
│   ├── core/                             🧊 前后端共享类型层：FieldType、zod schema、op-builder
│   ├── formula/                          🧊 公式语法（ANTLR）
│   ├── sdk/                              🧊 前端 SDK（grid/editor 组件冻结；hooks 内脏不动）
│   ├── openapi/                          🧊 REST 契约（URL/DTO 冻结，只允许加字段）
│   ├── ui-lib/  common-i18n/  icons/     🧊 UI 与文案
│   ├── db-main-prisma/                   ◐ 元数据 schema（宿主表收窄后只剩 user/setting/attachment）
│   └── v2/                               ★ 业务内核（v1/v2 合并的归宿）
│       ├── core/                         │   domain / commands / queries / ports（唯一业务实现）
│       ├── adapter-db-postgres-pglite/   │   桌面数据库（已存在）
│       ├── adapter-table-repository-postgres/  物理表 DDL/读写
│       ├── adapter-realtime-sharedb/     │   多人/保留；broadcastchannel/  多窗口
│       ├── adapter-undo-redo-keyv/       │
│       ├── formula-sql-pg/  field-dependency-core/  table-query-ops/
│       ├── import/  dottea/  table-templates/
│       ├── container-node/  container-browser/   组合根
│       └── e2e/                          │   pglite 上的内核测试（你的安全网）
│
├── scripts/
│   ├── smoke.mjs                         ★ 冒烟清单半自动执行（阶段 0）
│   ├── contract-snapshot.mjs             ★ openapi 契约快照比对（阶段 0）
│   └── v2-coverage-report.mjs            ★ x-teable-v2 缺口报表（阶段 0）
│
└── docs/                                 三份分析/蓝图文档
```

### 1.1 现状 → 终态映射表

| 现状路径 | 终态 | 动作与时机 |
|---|---|---|
| `features/{field,record,view,table,aggregation}/*/open-api/*.controller.ts` | `src/api/<域>/` | **平移保留**（URL 不变），service 换成调 v2 总线（阶段 1-4 逐片做） |
| `features/v2/`（75 个文件） | `src/kernel/{bridge,compat}` | 改名收拢；`*compat*` 文件在阶段 5 前全保留 |
| `src/share-db/` + `src/ws/` | `src/realtime/` | 收拢，协议不变 |
| `features/{attachments,import,export,selection,trash,setting,pin}` | `src/modules/{attachment,file-io,trash,settings,pin}` | 平移瘦身（阶段 6） |
| `features/{calculation,record/computed,record/record-modify,record/query-builder,field/field-calculate,db-provider}` | **删除** | 阶段 7（v2 全量接管后） |
| `features/{auth,oauth,mail-sender,invitation,notification,organization,risk-control,audit,cold-archive,record-history-cold,record-removal-cold,airtable-import,google-sheet-import,chat,template,short-link,base-sql-executor,canary,next,space 的 data-db-*}` | **删除** | 阶段 10（桌面裁剪） |
| `features/{user,collaborator}` | `src/modules/user-stub` | 只留单用户桩（createdBy/lastModifiedBy 需要） |
| `apps/nextjs-app/**`、`packages/{core,formula,sdk,openapi,ui-lib,common-i18n}` | 原地不动 | 🧊 冻结 |
| （无） | `apps/desktop/**` | 阶段 9 新建 |

> 说明：目录名保留 `nestjs-backend` 不改名（避免无意义的 import 雪崩）；它的"身份"由内容决定——到阶段 7 它已经不再是"业务后端"，而是"host 宿主 + 薄 API 层"。

---

## 2. 模块开发顺序（细化到模块）

> **成对交付原则**：阶段 1–6 的每个业务模块都是「v2 内核实现 + host 薄桥 + e2e/冒烟」三件套一起交付，不做"内核全写完再联调"。
> 工作量按 1 名熟悉 TS 的全职开发估算（不熟仓库 ×1.5–2）。

### 阶段 0 · 基线与护栏（约 1 周）—— 先造工具再干活

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 0.1 | 开发环境 | Makefile / .env | — | docker 起 pg+cache、`make postgres.mode`、`pnpm dev` 一条龙；写 `docs/dev-environment.md` 记录本机步骤 | 一条命令全家桶热重载 |
| 0.2 | 冒烟脚本 | `scripts/smoke.mjs` | 0.1 | 把 10 条冒烟清单半自动化（Playwright 走界面 或 openapi client 走接口） | 10 分钟手工 → 2 分钟一条命令 |
| 0.3 | 契约快照 | `scripts/contract-snapshot.mjs` | 0.1 | 导出 `packages/openapi` 全部路由的 URL+schema 为快照文件；改动即 diff 报警 | 防止破坏前端的护栏上线 |
| 0.4 | v1/v2 缺口报表 | `scripts/v2-coverage-report.mjs` | 0.1 | 跑冒烟收集 `x-teable-v2` 头，输出"接口 × 走向"矩阵 | 一张缺口表，阶段 1 排期的依据 |

### 阶段 1 · 字段模块（约 1.5 周）—— 选它打样是因为最独立

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 1.1 | 类型对齐核对 | `packages/core` ↔ `v2/core/domain/table/fields` | 0.4 | 逐个核对 20 种字段的枚举/schema/options 两代定义差异，列差异处理表 | 差异表评审通过 |
| 1.2 | 基础字段 CRUD | `v2/core/commands/*Field*` + `src/api/field/` | 1.1 | 文本/数字/单选/多选/日期/勾选/评分：create/update/delete + DTO 映射桥（照抄 `field-open-api-v2.service.ts` 样板） | 界面字段面板全绿，`x-teable-v2: true`，v2 e2e 过 |
| 1.3 | 字段类型转换 | 同上 | 1.2 | 类型互转（含已有数据迁移策略） | 设计页改类型不丢数据 |
| 1.4 | 复杂字段 | 同上 | 1.2 | formula/link/lookup/rollup/autoNumber/created*/user/attachment/button | 冒烟"字段"部分全绿 |
| 1.5 | **打样文档** | `docs/slice-playbook.md` | 1.2 | 记录"一个切片怎么切"的完整步骤（后面每模块照做） | 新人可照做第二个切片 |

### 阶段 2 · 记录模块（约 2 周）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 2.1 | 记录 CRUD | `v2/core/commands/*Record*` + `src/api/record/` | 1.2 | create/update/delete、批量写、系统列（createdTime/by） | 界面增删改查、刷新持久 |
| 2.2 | 记录查询 | `v2/core/queries/*` + `table-query-ops` | 2.1 | 分页/筛选/排序/分组/字段投影/搜索 | 表格滚动渲染正确 |
| 2.3 | 聚合统计 | `v2/core/queries/*Aggregate*` | 2.2 | count/sum/avg/unique…（21 种） | 视图底部统计正确 |
| 2.4 | 记录扩展操作 | 同上 | 2.1 | duplicate / archive / restore / 表单 submit | 冒烟"记录"部分全绿 |

### 阶段 3 · 计算模块（约 2 周）—— 最难，放中间因为依赖字段/记录

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 3.1 | 依赖图维护 | `v2/core/domain/computed` + `field-dependency-core` | 1.x | reference 边的增删、拓扑分层 | v2 e2e：改字段定义影响面正确 |
| 3.2 | 公式求值与下推 | `formula` + `formula-sql-pg` | 3.1 | 内存求值与 SQL 下推行为对齐（87 函数） | 公式冒烟 + 函数级 e2e |
| 3.3 | 链接级联 | `v2/adapter-table-repository-postgres` | 3.1 | link 对称字段/FK/中间表、lookup/rollup 重算 | 链接冒烟：改 A 表 B 表跟着变 |
| 3.4 | 计算编排（单机化） | `v2` computed-outbox → 本地队列 | 3.2/3.3 | 桌面单机下 outbox 用进程内队列驱动；重算结果经 compat 广播 | 改单元格 → 界面公式秒级刷新 |

### 阶段 4 · 视图与表模块（约 1 周）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 4.1 | 视图 CRUD 与配置 | `v2/core/commands/UpdateView*` + `src/api/view/` | 2.2 | 六种视图、filter/sort/group/列宽/隐藏/锁定 | 视图工具栏全绿 |
| 4.2 | 表管理 | `v2/core/commands/*Table*` + `src/api/table/` | 1.x | 建表/改名/复制/删除/物理 DDL | 设计页全绿 |
| 4.3 | 撤销重做 | `v2` undo 命令 + `adapter-undo-redo-keyv` | 2/4 | 全操作集 undo/redo（本地 Keyv） | 冒烟 undo 项全绿 |

### 阶段 5 · 实时与兼容（约 0.5–1 周）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 5.1 | ShareDB 兼容核验 | `src/kernel/compat` + `src/realtime` | 阶段 2-4 | v2 事件 → 旧 op 形状全量核对；前端 `use-instances` 不改 | 双窗口实时同步回归全绿 |
| 5.2 | presence（在线光标） | 同上 | 5.1 | 保留或标记可裁 | 两窗口互见光标（或确认删除） |

### 阶段 6 · 周边数据功能（约 1.5 周）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 6.1 | 附件（本地存储） | `src/modules/attachment` | 1.4 | 本地盘上传/预览/缩略图/删除；URL 签名换本地协议 | 附件字段冒烟 |
| 6.2 | CSV 导入 | `src/modules/file-io` | 2.x | PapaParse；**去 BullMQ 同步/worker_threads 化** | 大文件导入不卡 UI |
| 6.3 | CSV 导出 | 同上 | 2.2 | 视图过滤条件下的导出 | 导出结果与视图一致 |
| 6.4 | 选区与粘贴 | 同上 + v2 | 2.1 | copy/paste/fill/clear 序列化 | 多单元格粘贴冒烟 |
| 6.5 | 回收站 | `src/modules/trash` | 2.x | 记录/表软删与恢复（v2 事件驱动） | 冒烟回收站项 |
| 6.6 | .tea 工程文件（可选） | `v2/dottea` | 4.x | 用 dottea 归档做桌面"保存为文件" | 另存/打开一个 .tea |

### 阶段 7 · v1 内核删除（约 1 周）—— 合并收官

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 7.1 | 删 v1 计算/写路径/SQL 生成 | 删 §1.1 标删目录 | 1-6 全部 | 逐目录删、`pnpm typecheck` + 全量 e2e 兜底 | 仓库只剩一套业务实现 |
| 7.2 | 两代模型收编 | `packages/core` vs `v2/core` | 7.1 | core 定案为"前端共享类型层"，重复校验逻辑以 v2 为准 | 无重复业务逻辑 |
| 7.3 | （可选）host 去 NestJS 化评估 | `src/api` | 7.1 | 评估薄控制器换 Hono/Express（v2 有 contract-http-hono）；不做也行 | 决策记录 |

### 阶段 8 · 基础设施本地化（约 1.5 周）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 8.1 | 缓存/队列本地化 | `src/infra/{cache,queue}` | 7 | sqlite 缓存 + 进程内队列设为默认；移除 Redis/BullMQ 依赖路径 | 不设 REDIS_URI 全功能可用 |
| 8.2 | PGlite 切换 | `src/kernel/container` | 7 | v2 组合根换 `adapter-db-postgres-pglite`；宿主剩余 Prisma 调用迁 v2 仓储或走 PG 协议桥 | 干净机器无 Docker 跑通冒烟 |
| 8.3 | 数据初始化与迁移 | `scripts/` + kernel | 8.2 | 首启自举 schema（`ensureSchema`）、旧数据导入路径（可选） | 首启 30 秒内可编辑 |

### 阶段 9 · 桌面壳（约 1.5 周，可与阶段 8 并行）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 9.1 | Electron 主进程 | `apps/desktop/src/main` | 8.1 | spawn host、随机端口、单实例锁、优雅退出、启动 splash | 窗口里完整跑冒烟清单 |
| 9.2 | preload 与原生能力 | `src/preload` | 9.1 | 文件对话框（打开/保存）、托盘、外链用系统浏览器 | 导入文件走系统对话框 |
| 9.3 | 开发模式集成 | `src/renderer-bridge` | 9.1 | dev 连 `pnpm dev` 端口（**改代码→桌面窗口即时热更**）；prod 加载本机端口 | 边开发边看最终效果 |
| 9.4 | 打包分发 | `electron-builder.yml` | 9.1 | win 安装包、图标、体积裁剪（standalone 产物） | 双击安装→可用 |

### 阶段 10 · SaaS 裁剪（约 1 周）

| # | 模块 | 位置 | 依赖 | 内容 | 验收标准 |
|---|---|---|---|---|---|
| 10.1 | 删 SaaS 模块 | 按 §1.1 删除清单 | 9 | auth/oauth/邮件/邀请/通知/组织/风控/审计/冷存/外部导入/模板/短链… | 体积/依赖明显下降 |
| 10.2 | 权限桩 | `src/modules/user-stub` | 10.1 | 全局 PermissionGuard 换"恒定 owner"桩（**保留文件桩，别硬删**） | 各页面无 403 |
| 10.3 | 设置与本地偏好 | `src/modules/settings` + 前端设置页 | 10.1 | 数据目录、语言、外观 | 桌面设置页可用 |

### 阶段 11 · 打磨（持续）

| # | 模块 | 内容 |
|---|---|---|
| 11.1 | 自动更新 | electron-updater + 更新通道 |
| 11.2 | 性能压测 | 百万行滚动、批量公式重算、PGlite 边界 |
| 11.3 | 错误处理/崩溃恢复 | 本地数据损坏自检（integrity 模块桌面化）、自动备份 |
| 11.4 | 许可与品牌 | AGPL 合规检查（分发须开源、Teable 品牌条款）——商用闭源须先取得授权 |

---

## 3. 依赖关系总览（波次视图）

```
阶段0 基线护栏 ──┬─► 阶段1 字段 ──► 阶段2 记录 ──► 阶段3 计算 ──► 阶段4 视图/表
                │        └────────────┬────────────┘               │
                │                     ▼                            │
                │              阶段5 实时兼容 ◄─────────────────────┘
                │                     │
                ├─► 阶段6 周边（附件/导入导出/回收站）──► 阶段7 删 v1 收官
                │                                              │
                └────────────► 阶段8 本地化 ◄───────────────────┤
                                     │                         │
                              阶段9 桌面壳 ◄────────────────────┤
                                     │                         │
                              阶段10 SaaS 裁剪 ◄────────────────┘
                                     │
                              阶段11 打磨（持续）
```

**可并行点**：阶段 9（壳）与阶段 8（内核本地化）可并行；阶段 6 的 6.1 附件可提前到阶段 2 之后做（记录-附件耦合）；单人做按序走，双人则一人内核（1-5）一人宿主/壳（6/8/9）。

---

## 4. 里程碑检查点（每到一个就停下来验收）

| 里程碑 | 检查内容 |
|---|---|
| M0 | `pnpm dev` 一条命令起全家桶；冒烟 2 分钟跑完；契约快照护栏在线 |
| M1 | 字段切片全绿 + `docs/slice-playbook.md` 产出（后续切片提速） |
| M2 | 记录+聚合全绿，界面日常操作不回落 v1 |
| M3 | 计算链路全绿（公式/链接/级联），双窗口实时同步正确 |
| M4 | 冒烟清单 100% 走 v2（`x-teable-v2` 全绿） |
| M5 | v1 内核目录删除，typecheck/e2e 全绿 |
| M6 | 无 Redis/无 MinIO/无 Docker 单机跑通 |
| M7 | Electron 安装包完成冒烟清单（**产品成形点**） |
| M8 | SaaS 模块清零，安装包体积达标（自定目标，如 <150MB） |

---

## 5. 首周任务卡（可以直接开工）

```
Day 1   0.1 开发环境（docker pg + pnpm dev + 种子账号登录成功）
Day 2   0.2 冒烟脚本（先把手工清单跑 3 遍形成肌肉记忆，再脚本化）
Day 3   0.3 契约快照（导出 openapi 430 条，提交为基线文件）
Day 4   0.4 缺口报表（FORCE_V2_ALL=true 跑冒烟，出接口×走向矩阵）
Day 5   1.1 类型对齐核对 + 定 1.2 字段切片的范围（先 text/number 两类打样）
```

每张任务卡完成的定义都是"可演示"：环境能跑、脚本能执行、报表能打开、差异表能评审。
