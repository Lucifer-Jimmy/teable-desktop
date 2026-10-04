# 桌面二开 · 文件级重构对照表（P0 刚需范围）
> 生成时间：2026-10-04 ｜ 范围：个人桌面版 P0 = 字段 + 记录 + 视图 + 公式 + 链接 + 导入导出 + Grid
> 图例：**✅ 直接套用**（不改或几乎不改）｜**✏️ 需要修改**（注明改什么）｜**🆕 需要新写**｜**🗑 删除**（点名，细节见 analysis §3.3）

---

## 0. 一条总原则 + 一个关键决策

**总原则**：价值都在 `packages/`（MIT）里——内核（v2/core）、公式、字段模型、Grid 组件全部 ✅ 原样用；✏️ 修改集中在 `apps/nestjs-backend`（换内脏）和少数几个"接缝文件"。

**关键决策 D1：✅ 已定 = 方案 B —— 移除 ShareDB（2026-10-04 决定）**

个人使用场景不需要协作组件。替代设计见 §2.4：sdk 数据层以 react-query 内脏重写、**保留 hooks 与 model 外壳签名**，组件层零改动；`share-db/`、`ws/`、`adapter-realtime-sharedb`、`op-builder` 全部删除。连带收益：原"阶段 5 实时兼容"取消，ShareDB 从依赖树消失。

---

## 1. ✅ 直接套用清单（你的资产，几乎不改）

### 1.1 `packages/core` — 领域类型层（前端也在用，冻结）

| 文件/目录 | 内容 |
|---|---|
| `src/models/field/constant.ts` | 20 种字段类型枚举（产品能力边界） |
| `src/models/field/field.ts` + `field.schema.ts` + `field-validation.ts` | 字段基类与校验 |
| `src/models/field/derivate/*.field.ts` + `*.option.schema.ts` | 20 类字段实现（文本/数字/日期/单选/多选/勾选/评分/链接/公式/Rollup/…，每类一对文件） |
| `src/models/view/`（`view.schema.ts`、`filter/`、`sort/`、`group/`、`column-meta.schema.ts`、`derivate/` 六种视图） | 视图配置模型 |
| `src/models/record/`、`src/models/table/table-domain.ts` | 记录/表域对象 |
| `src/formula/evaluate.ts`、`visitor.ts`、`typed-value*.ts`、`functions/`（87 个函数） | **公式求值器（方言无关，核心资产）** |
| `src/op-builder/` | ShareDB op 构造器（方案 A 下保留） |
| `src/models/aggregation/statistics-func.enum.ts` | 21 种聚合函数 |

### 1.2 `packages/formula` — 公式语法（ANTLR）

`parser/Formula.g4`、`parse-formula.ts`、`field-reference.visitor.ts`、`conversion.visitor.ts`（公式→SQL，给 PGlite 用）、`function-call-collector.visitor.ts`

### 1.3 `packages/v2/core` — 业务内核（重构的主资产）

| 目录 | 内容 | 用法 |
|---|---|---|
| `src/domain/table/fields/`（20 类字段 domain + `LinkFieldConfig.ts`、`LinkRelationship.ts`） | 字段领域模型 | ✅ 原样 |
| `src/domain/table/views/`、`records/`、`specs/`、`events/`、`methods/` | 视图/记录/规格/事件 | ✅ 原样 |
| `src/domain/formula/`、`domain/computed/`、`domain/shared/` | 公式/计算/分页排序 | ✅ 原样 |
| `src/commands/`（约 180 个文件：`CreateField*`、`UpdateField*`、`CreateRecords*`、`UpdateView*`、`CreateTable*`、`UndoCommand`…） | 全部写操作 | ✅ 按模块分批接线 |
| `src/queries/`（List/Get/Aggregate/Count/RecordSearch…） | 全部读操作 | ✅ 同上 |
| `src/ports/` + `defaults/`（Noop）+ `memory/` | 端口定义与兜底 | ✅ 原样（桩见 §3） |
| `src/ARCHITECTURE.md` | 分层红线（Table 域进内核，宿主不进） | 读 |

### 1.4 `packages/v2` 适配器与支撑包（PGlite 路线全套）

| 包 | 关键文件 | 判定 |
|---|---|---|
| `adapter-db-postgres-pglite` | `createDb.ts`、`kyselyPgliteBrowser.ts`、`di/register.ts` | ✅ 你的桌面数据库 |
| `adapter-db-postgres-shared` | UnitOfWork | ✅ |
| `adapter-repository-postgres` | `db/schema.ts`（`ensureSchema` 自举建表）、table/field/view 仓储 | ✅ |
| `adapter-table-repository-postgres` | 物理 DDL/记录读写/计算字段（`schema/naming.ts` 管动态表命名） | ✅（最大适配器，198 实现文件，**只复用不重写**） |
| `adapter-table-query-ops-postgres` | 筛选/排序/分组/搜索 SQL | ✅ |
| `formula-sql-pg` | `FormulaSqlPgTranslator.ts` 等（公式→PG SQL，PGlite 直接能跑） | ✅ |
| `field-dependency-core`、`table-query-ops`、`import`、`dottea`（.tea 归档→桌面工程文件）、`table-templates` | 支撑包 | ✅ |
| `adapter-csv-parser-papaparse`、`adapter-undo-redo-keyv`、`adapter-logger-console` | 轻量适配器 | ✅ |
| `container-browser/src/index.ts`（`registerV2BrowserPgliteDependencies`）、`container-node-test`（`pglite://` 协议识别） | 装配模板 | ✅ 当抄写蓝本 |

### 1.5 `packages/sdk` — UI 组件（样式零改动的保证）

| 目录 | 内容 |
|---|---|
| `src/components/grid/`（`Grid.tsx`、`InteractionLayer.tsx`、`RenderLayer.tsx`、`CellScroller.tsx`、`InfiniteScroller.tsx`、`managers/`、`renderers/`、`hooks/`、`configs/`） | **自研 Canvas 表格**，原样用 |
| `src/components/editor/`（`text/`、`number/`、`select/`、`date/`、`checkbox/`、`rating/`、`link/`、`formula/`、`attachment/`、`long-text/`） | 单元格编辑器，原样用 |
| `src/components/cell-value/`、`cell-value-editor/`、`expand-record/` | 值渲染与记录详情 |
| `src/components/{filter,sort,group,hide-fields,row-height,search}/` | 视图工具栏面板 |

### 1.6 其他 ✅

`packages/ui-lib/src/shadcn/ui/`（49 个组件）、`packages/ui-lib/src/base/`、`packages/common-i18n/src/locales/`（文案 JSON）、`packages/icons/`、`packages/openapi/src/zod.ts` 与各 schema（类型校验可继续用）。

---

## 2. ✏️ 需要修改的文件（一一指出，这是真正的"手术清单"）

### 2.1 跑起来的前提（第一周动的 5 处）

| # | 文件 | 改什么 |
|---|---|---|
| M1 | 🆕 `apps/nestjs-backend/src/infra/pglite/pglite-bootstrap.ts`（新文件） | 进程内起 PGlite + `@electric-sql/pglite-socket` 伪造成 PG 服务器（详见 `infra-first-switch.md`） |
| M2 | `apps/nestjs-backend/src/bootstrap.ts`（`bootstrap()` 在 `index.ts` 调用） | 在 `NestFactory.create` **之前**挂 M1 的启动调用 |
| M3 | `apps/nextjs-app/.env.development`（**env 文件在 nextjs-app 目录**，由 `configs/config.module.ts` 的 `resolveEnvFileDir()` 解析） | `BACKEND_CACHE_PROVIDER=sqlite`；不设 `BACKEND_CACHE_REDIS_URI`；`BACKEND_STORAGE_PROVIDER=local`；`PRISMA_DATABASE_URL`/`PRISMA_META_DATABASE_URL` 指向桥端口 + `connection_limit=1` |
| M4 | `apps/nestjs-backend/src/features/v2/v2-container.service.ts`（666 行，v2 装配中心） | 改装配：数据库 → pglite（或桥接 pg）；undo → 本地 Keyv；**去掉 `ShareDbPubSubPublisher`/Redis pubsub**（`src/share-db/sharedb-redis.pubsub.ts` 改为可选不注册）；realtime 仍用 `adapter-realtime-sharedb`（方案 A） |
| M5 | 登录旁路（单用户桩）：`apps/nextjs-app/src/lib/withAuthSSR.ts`、`src/lib/ensureLogin.ts` + 后端 `apps/nestjs-backend/src/features/auth/guard/auth.guard.ts`、`permission.guard.ts` | SSR 登录跳转改直接放行；全局 Guard 换"恒定 owner"桩（**保留文件、换实现**，不要删——所有 controller 都引用） |

### 2.2 确认级修改（大概率零改或一行改）

| # | 文件 | 说明 |
|---|---|---|
| M6 | `packages/sdk/src/context/app/useConnection.tsx` | WS 走同源 `/socket`（内嵌 Next + 本地 WS），Electron 下连 localhost 即可——确认无需改；若跨端口才动 `getWsPath()` |
| M7 | `packages/openapi/src/axios.ts` | `baseURL:'/api'` 同源假设成立，保留 |
| M8 | `apps/nestjs-backend/src/event-emitter/event-job/fallback/*` | 本地队列已是官方回退路径，无 Redis 自动启用——确认配置生效即可 |

### 2.3 随重构推进的修改（阶段式，每个业务模块一批）

| # | 文件 | 改什么 |
|---|---|---|
| M9 | `apps/nestjs-backend/src/features/{field,record,view,table,aggregation}/open-api/*-v2.service.ts`（样板：`field-open-api-v2.service.ts`、`field-open-api.controller.ts:127` 的 `@UseV2Feature` 分支） | 每个模块：删 v1 service 分支，controller 只留 v2 桥；URL/DTO 不变 |
| M10 | `apps/nestjs-backend/src/features/v2/*compat*.ts`（`v2-view-compat.service.ts`、`v2-record-history.service.ts` 等） | 方案 A 下保留喂 ShareDB；方案 B 才删 |
| M11 | `packages/core` 与 `packages/v2/core` 的重复校验 | 收敛：v2 为准，core 只留类型/schema（前端依赖） |
| M12 | `apps/nextjs-app/src/pages/`（42 个路由）+ `src/features/{auth,app/waitlist,admin,oauth}/` | 删登录/注册/分享/管理页（P1 裁剪时）；`pages/base/[[...slug]]` 等业务页不动 |
| M13 | `apps/nestjs-backend/src/features/next/next.service.ts` | 保留（内嵌 Next 是桌面壳的加载来源）；`features/next/plugin/*` 插件反代删 |

### 2.4 方案 B 实施设计（移除 ShareDB 后的数据层）

**新数据流（单用户）**：
```
UI 组件（不动） ──调用──► hooks（签名不变，内脏换）──► react-query（useQuery/useMutation）
                                                      │
                                    REST 契约（openapi URL，冻结）或进程内直调 v2 commandBus/queryBus
                                                      │
mutation 成功 ──► queryClient.invalidateQueries() ──► 界面刷新
（可选增强：v2 EventBus「records changed」→ 精确失效；多窗口以后用 adapter-realtime-broadcastchannel）
```

**🗑 整体删除**：`apps/nestjs-backend/src/share-db/`（26 文件）、`src/ws/`（11 文件）、`packages/v2/adapter-realtime-sharedb/`、`packages/core/src/op-builder/`、`packages/sdk/src/context/use-instances/`、`packages/sdk/src/model/`（Doc 封装）、`packages/sdk/src/context/app/{ConnectionProvider,useConnection,shareDbErrorHandler,ConnectionContext}`、`hooks/use-{connection,presence,table-listener,field-aware-table-listener}.ts`

**✏️ 重写（保外壳签名，换内脏）**：
| 文件 | 原实现 | 新实现 |
|---|---|---|
| `packages/sdk/src/context/{table,view,field,record,base}/` | ShareDB doc 订阅 | react-query 拉 openapi DTO，Provider 只做缓存分发 |
| `packages/sdk/src/hooks/use-{table,tables,field,fields,view,views,record,records}.ts` | 读 doc | `useQuery(GET_*_URL)` |
| `packages/sdk/src/model/*` 的方法（如 `record.updateCell`、`field.update`） | 提交 ShareDB op | 调对应 REST/命令 + `invalidate`（**方法签名不变**，组件调用处零改动） |
| `hooks/use-undo-redo.ts` | ShareDB/REST | 调 `api/undo`、`api/redo` REST（`features/undo-redo` 本就有 HTTP 接口） |
| `hooks/use-aggregation.ts`、`use-records-query.ts`、`use-infinite-records.ts` | 本就 REST/react-query | **基本不动**，仅核对 |

**✅ 不动**：`components/grid|editor|filter|sort|group|expand-record` 等全部 UI、`packages/openapi`、页面 blocks。

---

## 3. 🆕 需要新写（总量不大）

| 新件 | 位置 | 说明 |
|---|---|---|
| PGlite 启动件 | `apps/nestjs-backend/src/infra/pglite/` | 见 M1 |
| 端口桩 | v2 ports 的桌面实现：`CollaboratorDirectoryService`（恒定 owner）、`AttachmentLookupService`/`AttachmentUrlSignerService`（本地文件/自定义协议）、`ButtonClickWorkflowService`（Noop 已够） | 每个几十行，注册进组合根 |
| 本地组合根 | 仿 `container-browser/src/index.ts` 写 `container-desktop.ts` | pglite + 本地 undo + sharedb/noop realtime |
| Electron 壳 | `apps/desktop/`（`src/main/`、`src/preload/`、`electron-builder.yml`） | 启动 host、窗口加载本地 URL、文件对话框 |
| 开发/验收脚本 | `scripts/smoke.mjs`、`contract-snapshot.mjs` | 护栏 |
| （可选）设置持久化 | `src/modules/settings/` | 数据目录、语言 |

---

## 4. 🗑 删除清单（P0 成形后分批删；点名目录）

**v1 旧内核**（v2 全量接管后）：`features/calculation/`、`features/record/computed/`（9 个文件：`computed-orchestrator/evaluator/dependency-collector/link-cascade-resolver/...`）、`features/record/record-modify/`、`features/record/query-builder/`、`features/field/field-calculate/`、`features/db-provider/`

**SaaS 域**（P1 裁剪）：`features/{auth/local-auth,auth/social,auth/turnstile,oauth,mail-sender,invitation,notification,organization,risk-control,audit,cold-archive,record-history-cold,record-removal-cold,airtable-import,google-sheet-import,chat,template,short-link,share,base-share,plugin,plugin-panel,plugin-context-menu,dashboard,comment,base-sql-executor,canary}`、`features/space/data-db-*`、`features/user/tracking`、前端对应页面

**方案 B 时**：`apps/nestjs-backend/src/{share-db,ws}/`

---

## 5. 速查总表

| 区域 | 判定 | 一句话 |
|---|---|---|
| `packages/core`、`packages/formula` | ✅ 全套 | 领域类型 + 公式（求值器方言无关） |
| `packages/v2/core` + 全部 adapter/formula-sql-pg/import/dottea | ✅ 全套 | 业务内核与 PGlite 路线适配器 |
| `packages/sdk` 的 grid/editor/面板组件 | ✅ 全套 | UI 样式零改动 |
| `packages/ui-lib`、`common-i18n`、`icons`、openapi schema | ✅ 全套 | |
| `apps/nestjs-backend/src/features/v2/v2-container.service.ts` | ✏️ | 装配换 pglite/本地件 |
| `apps/nestjs-backend/src/bootstrap.ts` + 🆕 infra/pglite | ✏️🆕 | PGlite 桥接线 |
| `apps/nextjs-app/.env.development` | ✏️ | 去 Redis/MinIO/换连接串 |
| `withAuthSSR.ts`/`ensureLogin.ts` + auth/permission Guard | ✏️ | 单用户桩 |
| `features/*/open-api/*-v2.service.ts` | ✏️ | 逐模块收敛成唯一实现 |
| v2 ports 的 4 个宿主桩 + `container-desktop.ts` + `apps/desktop/` | 🆕 | 桌面专属件 |
| v1 旧内核 6 个目录 + SaaS 20+ 个目录 | 🗑 | 见 §4 |

---

*配套文档：`teable-desktop-analysis.md`（功能全景）、`desktop-rewrite-roadmap.md`（顺序）、`infra-first-switch.md`（去服务化步骤）、`desktop-target-structure-and-modules.md`（目标树）。*
