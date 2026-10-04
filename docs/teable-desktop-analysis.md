# Teable 桌面端二开分析报告
# ——业务功能实现地图、代码裁剪清单与轻量化改造路线

> 生成时间：2026-10-03 ｜ 基线：develop 分支（5ef223888）
> 目标读者：准备把 Teable 从「重量级在线协作平台」改造为「轻量桌面应用」的二开团队。
> 本文回答三个问题：**① 各业务功能在哪实现；② 哪些代码必须保留、哪些要轻量化替换、哪些直接删；③ 推荐的技术路线。**

---

## 0. 结论速览（TL;DR）

1. **Teable = 「表格领域引擎」+「SaaS 协作外壳」。** 桌面版的正确姿势是保住前者、砍掉后者。核心资产是：20 种字段类型、公式引擎（87 个函数）、字段依赖自动重算、自研 Canvas 表格组件、filter/sort/group 的 SQL 生成器。

2. **仓库里已经内置了一条「离线单机」技术路线，只是没有接线。** `packages/v2` 是一套全新的端口-适配器（ports & adapters）架构，自带：
   - **PGlite 适配器**（WASM 版 PostgreSQL，一个文件就是一个数据库，无需安装数据库服务）——连官方 e2e 测试默认都跑在它上面；
   - **BroadcastChannel 实时适配器**（无服务器的多窗口同步）；
   - **container-browser**（浏览器端组合根，即"不装数据库的单机装配清单"）。
   走这条路，**SQL 层零改动**，是成本最低的桌面化路径。

3. **前端核心可直接搬走。** 自研 Canvas 表格（`packages/sdk/src/components/grid`）、单元格编辑器、UI 组件库都是纯 React 代码，与 Next.js 无耦合。要动的只是路由、SSR 预取和 i18n（约 500+ 文件引用 Next.js API，有明确的替换清单，见 §4.3）。

4. **三个硬耦合点是改造的主战场**：Next.js（前端框架）、ShareDB+SockJS（实时协同栈）、PostgreSQL（唯一数据库方言）。**好消息是 Redis / MinIO / 队列都是可选的**——缓存支持 memory/sqlite/redis 三选一，任务队列在无 Redis 时自动回退进程内本地队列，附件存储默认就是本地磁盘。

5. **许可证红线**：`apps/*` 是 AGPL-3.0 且带品牌保护附加条款（**不允许移除 Teable 品牌元素**，分发即须开源）；`packages/*` 是 **MIT**（可闭源商用）。若做闭源商业桌面产品，应只复用 `packages/*`（含 v2 全套）+ 自写宿主壳，不要 fork `apps/*`。

6. **自动化工作流在这个开源仓库里只是企业版占位页**（页面提示"enterprise feature, view pricing"），引擎在企业版发行（teable-ee）中。二开时请按"没有自动化"规划，需要的话得自研。

---

## 1. 项目全景

### 1.1 产品定位

Teable 是「Airtable 的开源自托管替代品」：界面上是电子表格，底下是真 PostgreSQL。支持多视图（Grid/Kanban/画廊/日历/表单）、公式、链接字段、实时协同、插件、API。云端版还叠加了 AI Chat、App Builder、自动化等（后三者不在本开源仓库内）。

### 1.2 技术栈与部署形态

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | NestJS（Node 22）+ Prisma + Knex | `apps/nestjs-backend`，单进程同时提供 REST API + WebSocket + 内嵌 Next.js SSR |
| 前端 | Next.js（Pages Router）+ React | `apps/nextjs-app`，页面是薄壳，业务在 `src/features/**` |
| 前端 SDK | React + zustand + ShareDB client + react-query | `packages/sdk`，含自研 Canvas 表格 |
| 公式 | ANTLR4 语法解析 + 自研求值器 | `packages/formula` + `packages/core/src/formula` |
| 数据库 | PostgreSQL（唯一方言） | 元数据表 + 每个逻辑表一张动态物理表 |
| 缓存 | memory / sqlite / redis 三选一 | `BACKEND_CACHE_PROVIDER`，**redis 可选** |
| 任务队列 | BullMQ（Redis）或进程内本地队列 | 无 `BACKEND_CACHE_REDIS_URI` 时自动回退本地队列 |
| 对象存储 | local（默认）/ minio / s3 / aliyun | `BACKEND_STORAGE_PROVIDER`，**默认本地磁盘** |
| 实时协同 | ShareDB + SockJS + Redis PubSub | ops 广播/订阅，在线光标 |
| 新一代架构 | `packages/v2/*`（DDD + ports/adapters + DI） | 与旧代码并存，灰度开关切换 |

**生产部署三件套**（`dockers/`）：PostgreSQL + Redis + MinIO。但如上所示，Redis 与 MinIO 在单机场景都可降级。

### 1.3 仓库地图与代码体量

```
teable/
├── apps/
│   ├── nestjs-backend/     后端全部业务   275k 行 / 1162 文件   ← 最重
│   └── nextjs-app/         前端页面壳     117k 行 / 1113 文件
├── packages/               ← MIT 许可，二开重点复用区
│   ├── core/                领域模型（字段/视图/记录/公式/权限位） 31k 行
│   ├── formula/             公式语法（ANTLR4）                3k 行
│   ├── sdk/                 前端 SDK + 自研 Canvas 表格        67k 行
│   ├── openapi/             REST 契约（~430 个接口）           34k 行
│   ├── ui-lib/              shadcn 组件封装                    9k 行
│   ├── db-main-prisma/      元数据库 Prisma schema
│   ├── db-data-prisma/      数据库侧 Prisma schema
│   ├── common-i18n/         国际化文案（可直接复用）
│   └── v2/                  ★ 新一代架构（39 个包，见 §1.4）
└── plugins/                 官方插件宿主（独立 Next 小应用）    2k 行
```

体量参考：业务代码合计约 **56 万行** TS/TSX（不含 v2）；`packages/v2` 另有约 66 万行（其中约 30 万行是 e2e 测试与适配器测试，真实实现约 20 万行）。这就是"太重量"的来源——**其中对桌面单机无用的 SaaS 部分约占一半**。

### 1.4 两代架构并存（最重要的架构事实）

仓库里同时存在两代实现，通过灰度开关（canary，`FORCE_V2_ALL` 环境变量 / Base 级开关 / 请求头）选择走哪条：

| | v1（现状主力） | v2（新一代） |
|---|---|---|
| 位置 | `apps/nestjs-backend/src/features/*` | `packages/v2/*` + `apps/nestjs-backend/src/features/v2/`（接线层） |
| 架构 | NestJS 模块 + Service 直调 | DDD + Command/Query 总线 + ports/adapters + DI |
| 覆盖 | 全部业务 | **Table 限界上下文**（表/字段/视图/记录/公式/Base 生命周期），约 90 个特性点已可切换 |
| 存储 | Prisma + Knex 直写 PG | Kysely + 仓储适配器（**可换 PGlite**） |
| 实时 | ShareDB（唯一） | `IRealtimeEngine` 端口：ShareDB 或 **BroadcastChannel** 或 Noop |
| 与前端关系 | 前端 SDK 直连 ShareDB + REST | 有独立 HTTP 契约（oRPC）与客户端 |

**对二开的含义**：做桌面版**不要在 v1 上大动刀**（275k 行 NestJS 与 Prisma/Knex/ShareDB 纠缠太深），而应该**站在 v2 的端口架构上**，把 v2 的适配器换成轻量实现——这正是 v2 设计者预留的玩法（`container-browser` + PGlite 就是证据）。v2 未覆盖的部分（附件、导入导出、插件、仪表盘等宿主功能）再按需从 v1 移植或用轻量方案补。

---

## 2. 业务功能 → 代码位置全图

> 路径均相对仓库根。★ = 桌面版必须保留；◐ = 按需取舍；✕ = 可删。

### 2.1 核心表格域（产品灵魂）★ 全部保留

| 功能点 | 实现位置 | 实现方式 | 量级 |
|---|---|---|---|
| ★ 字段类型系统（20 种） | `packages/core/src/models/field/`（枚举 `constant.ts`，每类型一个 `derivate/xxx.field.ts`）；后端工厂 `apps/nestjs-backend/src/features/field/model/factory.ts` | zod schema 定义字段 options；类型：文本/长文本/数字/日期/单选/多选/勾选/评分/用户/附件/链接/公式/Rollup/条件Rollup/自动编号/按钮/创建时间/修改时间/创建人/修改人。**Lookup 不是独立类型**，是任意类型上的 `isLookup` 标志位 | core 124 文件 9.4k 行 |
| ★ 记录 CRUD 与存储 | `apps/nestjs-backend/src/features/record/`（`record-open-api.service.ts`、`record-modify/`、`record.service.ts` 3239 行） | **每个逻辑表 = 一张动态物理表，每字段一列**（多值字段用 jsonb），系统列 `__id/__auto_number/__created_time/...`；写入走 Knex 批量 UPDATE + 临时表 join | 53 文件 26.2k 行 |
| ★ 公式引擎 | `packages/formula/`（ANTLR4 语法）+ `packages/core/src/formula/`（`evaluate.ts` + 87 个函数） | **双引擎**：① 内存 EvalVisitor 逐条求值（写路径）；② 公式→PostgreSQL SQL（查询路径/GENERATED 物化列） | ~7k 行 |
| ★ 字段依赖与级联计算 | 依赖图 `prisma` 的 `Reference` 表 + `apps/nestjs-backend/src/features/field/field-calculate/field-supplement.service.ts`（2552 行）；链接级联 `features/calculation/link.service.ts`（2024 行）；编排 `features/record/computed/services/computed-orchestrator.service.ts` | 改单元格 → 依赖图（DAG）拓扑排序 → 分层批量重算下游公式/Lookup/Rollup → 事务提交后广播。**这是 Teable 最核心的资产之一** | 计算域合计 ~10k 行 |
| ★ 查询构建（filter/sort/group/搜索） | `features/record/query-builder/`（`sql-conversion.visitor.ts` 2487 行）+ `apps/nestjs-backend/src/db-provider/`（77 文件 13k 行） | Visitor 模式把视图 JSON 配置翻译成 SQL；方言抽象 `IDbProvider`（**实际只实现了 PostgreSQL**） | ~22k 行 |
| ★ 视图系统（6 种） | `packages/core/src/models/view/`（grid/kanban/gallery/calendar/form/plugin + filter/sort/group schema）+ `features/view/view.service.ts` | 视图配置 JSON 存元数据库 | 4.4k 行 |
| ★ 聚合统计（21 种） | `features/aggregation/aggregation.service.ts` + `db-provider/aggregation-query/` | 查询时计算不落库；Rollup 走持久化重算 | 2.9k 行 |
| ★ 表管理 / DDL | `features/table/table.service.ts`、`features/table-domain/`、`features/database-view/`（物化视图） | Knex 动态建表/改表 | 5k 行 |
| ★ 撤销/重做 | `features/undo-redo/`（v2 侧 `packages/v2/adapter-undo-redo-keyv`） | 栈存 Redis（v2 用 Keyv 可换本地存储） | 2.8k 行 |
| ★ 导入 CSV/Excel | `features/import/`（PapaParse + xlsx + worker_threads） | 大文件分片进队列异步解析 | 4.9k 行 |
| ★ 导出 CSV | `features/export/` | 流式 CSV（仅 CSV，无 Excel 导出） | 0.4k 行 |
| ◐ 选区批量操作 | `features/selection/`（复制/粘贴/填充/清除，SSE 流式） | 表格剪贴板语义 | 4.3k 行 |
| ◐ 数据完整性修复 | `features/integrity/`（链接字段/外键一致性检查修复；v2 有 schema 级检查器） | 桌面版保留为"修复工具"入口即可 | 4.4k 行 |
| ◐ ERD 关系图 | `features/graph/graph.service.ts` | 字段有向图 → 节点/边 | 1k 行 |

**计算链路一句话**（改一个单元格后发生什么）：
`REST 写入 → 生成变更单元格 → ComputedOrchestrator 在写事务内：依赖收集（递归 CTE 沿 reference 表求下游闭包 + Link 边 BFS 反查受影响记录）→ 链接字段对称变更与外键表计划 → 批量写库 → 按拓扑分层重算公式/Lookup/Rollup 并写回 → 事务提交后 ShareDB 广播 ops → 前端增量更新`。
（v2 侧是等价的 Outbox 管线：`packages/v2/core/src/domain/computed/` + `features/v2/computed-outbox-trigger/`，可异步/重试。）

### 2.2 协同与权限域 ◎ 大幅裁剪

| 功能点 | 实现位置 | 桌面版建议 |
|---|---|---|
| 邮箱密码登录/注册 | `features/auth/local-auth/`（bcrypt + 邮件验证码） | ✕ 删，或留极简本地登录 |
| 会话（express-session + JWT） | `features/auth/session/`、`jwt/teable-jwt.service.ts` | ✕ 删（单用户免登） |
| 社交登录（GitHub/Google/OIDC） | `features/auth/social/` | ✕ 删 |
| OAuth2 授权服务器（PKCE/设备码） | `features/oauth/`（3.5k 行） | ✕ 删 |
| API Token | `features/access-token/` | ◐ 保留（本地自动化/脚本调用有用） |
| 权限模型（5 角色 × 权限位矩阵） | `packages/core/src/auth/role/constant.ts` + `features/auth/permission.service.ts`（1160 行）+ 全局 `PermissionGuard` | ◐ 简化为 owner/viewer 或纯桩；**注意权限 Guard 是全局挂载的，所有 controller 都依赖，不能直接删文件** |
| 协作者管理 | `features/collaborator/` | ✕ 删（或留"局域网协作"二期） |
| 邀请（邮件/链接） | `features/invitation/` + `features/mail-sender/`（SMTP） | ✕ 删 |
| 视图分享（匿名只读链接） | `features/share/`（4.7k 行，密码保护 + 权限收敛） | ◐ 有用：「导出分享给他人看」场景可后期加 |
| Base 分享 | `features/base-share/` | ◐ 同上 |
| 空间/文件夹层级 | `features/space/`、`features/base-node/`（BaseNode 树） | ★ 保留"base 内文件夹导航"，删 space 多租户部分 |
| 通知 | `features/notification/` | ✕ 删 |
| 组织/部门（企业版桩） | `features/organization/` | ✕ 删（连带 permission 里部门分支） |
| 风控（外部 Cloudflare Worker） | `features/risk-control/` | ✕ 删 |
| 审计 | `features/audit/` | ✕ 删（或降级为本地日志） |
| 埋点/候补名单 | `features/user/tracking/`、waitlist | ✕ 删 |
| Pin 收藏 / 最近访问 | `features/pin/`、`features/user/last-visit/` | ★ 保留（纯本地 UX） |

**认证方式全集**（供参考）：邮箱密码、Session Cookie、JWT 临时 token、GitHub/Google/OIDC、OAuth2 授权码+PKCE+设备码、API Token（Bearer）、分享链接匿名、匿名用户、Turnstile 人机验证。桌面版一个都不需要（或只需 API Token）。

### 2.3 周边功能域 ◐ 按需取舍

| 功能点 | 实现位置 | 说明 / 桌面版建议 |
|---|---|---|
| ★ 附件存储 | `features/attachments/`（`plugins/adapter.ts` 是抽象接口，`local/minio/s3/aliyun` 四实现） | **默认就是本地磁盘**（`BACKEND_STORAGE_PROVIDER=local`）→ 桌面版几乎零改动；含 sharp 缩略图、预签名 URL |
| ◐ 插件系统 | `features/plugin/` + `plugin-panel/` + `plugin-context-menu/`；前端 `components/plugin/` + `packages/sdk/src/plugin-bridge/`（penpal RPC）；官方插件宿主 `plugins/` | **iframe + penpal 桥**，插件是独立部署的 Web 应用；插件"市场"只是本地 PG 表（**不依赖云端**）；官方内置 chart（图表）与 sheet-form-view。二期保留：架构上桌面端需允许加载本地/远程 iframe |
| ◐ 仪表盘 + 图表 | `features/dashboard/` + 官方 chart 插件（`plugin/official/chart/`） | 仪表盘只是布局容器，图表 = BaseQuery。可二期 |
| ◐ 评论 | `features/comment/` | 可删 |
| ◐ 回收站 | `features/trash/`（记录/表级软删 + 恢复） | ★ 建议保留（本地误删保护），v2 有对应 trash 事件 |
| ◐ 记录历史 | `RecordHistory` 表 + `features/record-history-cold/`（冷存归档） | 保留历史记录本身；**冷存归档 ✕ 删**（那是对象存储上的 NDJSON 分片/合并/压缩体系，2 万行，纯 SaaS 规模化设施） |
| ◐ AI（字段填充/生成） | `features/ai/`（Vercel AI SDK，十余家 provider 适配） | 二期可选：保留 provider 抽象，用户配自己的 API key |
| ✕ Chat 代理 | `features/chat/`（OpenAI 兼容反代，100 行） | 可删 |
| ✕ Airtable / Google Sheet 导入 | `features/airtable-import/`（5.6k 行）、`features/google-sheet-import/` | 可删（依赖外部 SaaS API） |
| ✕ 模板中心 / 短链 | `features/template/`、`features/short-link/` | 可删（云端运营设施） |
| ✕ Base SQL 执行器 | `features/base-sql-executor/`（PG 只读角色 + AST 白名单） | 可删或二期（桌面版可直接开放只读 SQL） |
| ✕ 站点管理后台 | `features/setting/open-api/`（品牌/许可/群发） | 删 |
| ✕ 自动化工作流 | 前端 `apps/nextjs-app/src/features/app/automation/` 仅 93 行占位页（"企业版功能"） | **本仓库无引擎**，别指望；需要就自研 |
| ✕ 冷存三件套 | `features/cold-archive/`、`record-history-cold/`、`record-removal-cold/`（合计 ~12k 行） | 全删 |
| ◐ 数据库直连（BYODB） | `features/space/data-db-*`（约 2 万行，按 space/base 挂外部数据库） | 全删（单机单库） |

### 2.4 基础设施层 → 轻量化替换表

| 基础设施 | 现状用途 | 桌面版替换 | 依据 |
|---|---|---|---|
| PostgreSQL | 元数据 + 动态记录表 + generated column | **PGlite**（`packages/v2/adapter-db-postgres-pglite`，官方已实现且 e2e 默认在用）；或打包嵌入式 Postgres 二进制 | SQL 方言不变，零 SQL 改动 |
| Redis | 缓存/会话/undo 栈/队列/PubSub | **已可不用**：缓存切 `memory`/`sqlite`（`BACKEND_CACHE_PROVIDER`），队列自动回退本地队列（`event-job/fallback/local-queue.provider.ts`） | v1 自带降级路径 |
| MinIO/S3 | 附件/冷存/logo | **本地磁盘**（已是默认实现 `features/attachments/plugins/local.ts`） | 零改动 |
| BullMQ 队列 | 导入分片/裁剪/冷存/outbox | 本地队列（已有）或 worker_threads 直调 | v1 自带 |
| ShareDB + SockJS + Redis PubSub | 实时协同/ops 广播/在线光标 | 单窗口：v2 `NoopRealtimeEngine`；多窗口：`adapter-realtime-broadcastchannel`（官方已写好） | v2 端口架构 |
| SMTP 邮件 | 验证码/邀请/通知 | 删 | — |
| Sentry/OTel | 可观测 | 删或换本地日志（v2 有 `adapter-logger-console`） | — |
| Next.js SSR | 页面渲染/SEO/鉴权跳转 | 前端改 Vite + 客户端渲染（见 §4.3） | 见替换清单 |
| 分布式锁/多实例 | 水平扩展 | 删（单机无需） | — |

### 2.5 前端实现地图（复用资产）

| 资产 | 位置 | 与框架关系 |
|---|---|---|
| ★ 自研 Canvas 表格（虚拟滚动/渲染/选区/交互） | `packages/sdk/src/components/grid/`（Grid.tsx、InteractionLayer、RenderLayer、managers/、renderers/） | **纯 React + Canvas，框架无关**。不是 AG Grid，是自研的，性能设计（"百万行不卡"）就靠它 |
| ★ 单元格编辑器（按字段类型） | `packages/sdk/src/components/editor/`（text/number/select/date/link/attachment/formula…）+ `cell-value-editor/` | 纯 React |
| ★ 字段配置面板 | `apps/nextjs-app/src/features/app/components/field-setting/` | 纯 React（在 app 内，搬运时一并带走） |
| ★ 视图工具栏（筛选/排序/分组/隐藏字段面板） | `apps/nextjs-app/src/features/app/blocks/view/tool-bar/` + `packages/sdk/src/components/{filter,sort,group,...}` | 纯 React |
| ★ 记录展开/详情/历史 | `packages/sdk/src/components/expand-record/` | 纯 React |
| 数据访问 hooks | `packages/sdk/src/hooks/`（use-records/use-fields/use-views…） | **与 ShareDB 强耦合**（`context/use-instances/` + `model/`），换数据层时这里是主战场 |
| REST 契约 | `packages/openapi/`（zod + axios，~430 接口） | 纯 TS，可复用或只抽 schema |
| UI 组件库 | `packages/ui-lib/src/shadcn/ui/`（49 个组件） | 纯 React |
| 国际化文案 | `packages/common-i18n/src/locales/*.json` | 直接复用（把 next-i18next 换 react-i18next） |
| 插件桥 | `packages/sdk/src/plugin-bridge/`（penpal RPC 协议） | 纯 TS |
| 仪表盘/图表 | `apps/nextjs-app/src/features/app/blocks/dashboard/`、`chart/` | 纯 React |

**Next.js 耦合面**（改造量参考）：约 511 个文件 import 了 next/*，其中 next-i18next 456 处、next/router 115 处、next/link 38 处；每页有 `getServerSideProps` SSR 预取。业务 API **不在** Next 里（都在 NestJS），所以换掉 Next 只影响渲染层，不动业务接口。

---

## 3. 桌面版裁剪清单（核心交付物）

### 3.1 直接保留（复用，不改或微改）

| 代码 | 许可 | 备注 |
|---|---|---|
| `packages/core`（字段/视图/记录模型、公式求值、权限位） | MIT | 领域模型核心 |
| `packages/formula`（ANTLR 语法） | MIT | |
| `packages/v2/core`（domain/commands/queries/ports） | MIT | **桌面版的业务内核** |
| `packages/v2/formula-sql-pg`、`field-dependency-core`、`table-query-ops`、`import`、`dottea`（.tea 归档格式——可做桌面原生文件格式） | MIT | |
| `packages/v2/adapter-db-postgres-pglite` + `adapter-db-postgres-shared` + `adapter-repository-postgres` + `adapter-table-repository-postgres` + `adapter-table-query-ops-postgres` | MIT | PGlite 路线的全套 SQL 层 |
| `packages/v2/adapter-realtime-broadcastchannel`、`adapter-undo-redo-keyv`、`adapter-csv-parser-papaparse`、`adapter-logger-console` | MIT | 轻量适配器 |
| `packages/v2/container-browser` | MIT | **单机装配清单**（registerV2BrowserPgliteDependencies） |
| `packages/sdk` 的 grid/editor/expand-record/filter 等组件 | MIT | 前端可视资产 |
| `packages/ui-lib`、`packages/icons`、`packages/common-i18n` | MIT | |
| `packages/openapi` 的 zod schema | MIT | 校验与类型定义可复用 |
| `apps/nestjs-backend/src/features/attachments/` 的 local 存储实现 | AGPL ⚠ | 可参考实现思路自写一个精简版（几小时内），避免 AGPL 传染 |
| 字段配置面板 / 视图工具栏 / dashboard 块（nextjs-app 内） | AGPL ⚠ | 同上：搬逻辑不如按原型重写 UI 层（组件多为 shadcn 布局拼装） |

### 3.2 轻量化替换（换实现，保语义）

| 原实现 | 轻量替代 | 工作量级 |
|---|---|---|
| PostgreSQL 服务 | **PGlite**（数据即本地文件目录） | 小（v2 适配器已存在，接线即可） |
| ShareDB + SockJS + WebSocket | v2 `IRealtimeEngine`：单窗口 Noop / 多窗口 BroadcastChannel | 小（适配器已存在） |
| Redis 缓存/undo 栈 | memory 或 sqlite 缓存；Keyv 本地存储 | 小（v1 已支持；v2 undo-redo-keyv 可配本地 store） |
| BullMQ 队列 | 进程内本地队列 / worker_threads | 小（v1 自带回退；桌面版直接同步化更简单） |
| MinIO/S3 附件 | 本地文件系统（app 数据目录） | 小 |
| Next.js SSR 前端 | **Vite + React Router + 客户端数据加载** | 中（见 §4.3 替换清单，约 2-4 周） |
| express-session/JWT 登录 | 免登录单用户（或本地 PIN） | 小 |
| SMTP 邮件 | 删除通知渠道 | 小 |
| 前端数据层（ShareDB 订阅 hooks） | 新 hooks 调 v2 command/query（进程内直调 commandBus，连 HTTP 都可以省） | **中-大（主战场）** |
| 附件 URL 签名（token 加密过期 URL） | 本地 `file://` / Tauri 自定义协议 | 小 |

### 3.3 整块删除（约 15-20 万行）

```
apps/nestjs-backend/src/features/:
  oauth/  auth/social/  auth/turnstile/  auth/local-auth/  auth/session/  # 账号体系
  organization/  risk-control/  invitation/  mail-sender/  notification/ # 组织运营
  audit/  user/tracking/  setting/open-api/                               # 合规运营
  airtable-import/  google-sheet-import/  chat/  template/  short-link/   # 外部集成/运营
  cold-archive/  record-history-cold/  record-removal-cold/               # 规模化冷存（12k 行）
  space/data-db-*(BYODB)  base-sql-executor/  canary/  next/             # 多租户基础设施
  comment/  dashboard/  plugin*/  ai/                                     # （若确定不要，二期再评估）
apps/nestjs-backend/src/{ws,share-db}/                                   # 实时协同栈（换 BroadcastChannel）
apps/nextjs-app/src/features/{auth,app/waitlist,admin,oauth}/            # 对应前端
```

### 3.4 二期可选

仪表盘+图表、插件系统、视图分享、AI 字段填充、API Token、SQL 查询器、.tea 文件格式（作为桌面"工程文件"）、局域网多用户协同（BroadcastChannel → WebSocket）。

---

## 4. 推荐技术方案

### 4.1 三个候选方案

**方案 A（推荐）：v2 内核 + PGlite + Tauri/Electron 新壳**

```
┌─────────────────────────────────────────────────────┐
│ Tauri / Electron 壳（窗口、菜单、文件系统、托盘）        │
│  ┌───────────────────────────────────────────────┐  │
│  │ 渲染进程：Vite + React                          │  │
│  │   packages/sdk 可视组件（grid/editor/…）        │  │
│  │   新数据 hooks ──进程内直调──┐                  │  │
│  └──────────────────────────────┼────────────────┘  │
│  ┌──────────────────────────────▼────────────────┐  │
│  │ v2-core（domain/commands/queries）              │  │
│  │   ├─ adapter-db-postgres-pglite  → 本地数据文件 │  │
│  │   ├─ adapter-table-repository-postgres（复用）  │  │
│  │   ├─ adapter-realtime-broadcastchannel/noop    │  │
│  │   └─ adapter-undo-redo-keyv（本地）             │  │
│  │ 自写宿主层：本地附件、导入导出、文件夹树、设置     │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

- 优点：**最轻**（安装包可控制在几十 MB 级）、离线、无数据库服务、代码许可干净（全 MIT + 自写壳）、架构面向未来（与官方 v2 演进方向一致）。
- 工作量：**前端数据层重接**（ShareDB hooks → v2 commandBus/QueryBus，这是最大头）+ 宿主功能自写（附件/导入导出/文件夹）+ de-Next 化。估计 2-3 人月出可用 MVP。
- 注意：v2 覆盖 Table 限界上下文；仪表盘/插件/分享等宿主功能 v2 不管，要么不要、要么自写轻量版。

**方案 B：裁剪 v1 后端 + 打包嵌入式 PostgreSQL，前端 de-Next**

- 做法：保留 `apps/nestjs-backend`（按 §3.3 删模块），用嵌入式 Postgres（或 PGlite 的 PG 协议桥）替代数据库服务，Redis/MinIO 按 §3.2 降级，前端只做 de-Next（数据层不动，ShareDB 环回）。
- 优点：**前端几乎零改动**，功能保真度最高（v1 全功能都在），出活最快（1-1.5 人月出 MVP）。
- 缺点：包体重大（Node 运行时 + PG 内核 + 27 万行后端，安装包 200MB+ 起步）；AGPL 传染（fork 了 apps/*）；技术债原样背上（Prisma/Knex/ShareDB 纠缠、双管线并存）；长期演进仍要走向 v2。
- 适用：要快速验证产品形态、对体积/许可不敏感时。

**方案 C：桌面壳里塞 docker-compose 自托管**

- 不推荐：违背"轻量"初衷，用户机器要装 Docker，体验差。仅当目标用户是"想要私有部署的团队"时才考虑。

### 4.2 方案对比

| 维度 | A：v2+PGlite | B：裁 v1 | C：docker |
|---|---|---|---|
| 安装包体积 | ★ 小（几十 MB） | ✕ 大（200MB+） | ✕ 最大 |
| 离线可用 | ★ 完全离线 | ★ 离线 | ✕ 依赖 Docker |
| 出活速度 | ◐ 中（数据层重接是大头） | ★ 快 | ★ 最快（几乎不开发） |
| 功能完整度 | ◐ 核心全有，周边自选 | ★ 几乎全保留 | ★ 全保留 |
| 许可干净度 | ★ 全 MIT + 自写壳 | ✕ AGPL 传染 + 品牌条款 | ✕ 同 B |
| 长期演进 | ★ 与官方 v2 同向 | ✕ 背着双架构债 | ✕ |
| 二开自由度 | ★ 高 | ◐ 中 | ✕ 低 |

### 4.3 de-Next 替换清单（方案 A/B 通用）

1. **路由**：`src/pages/**`（42 个路由文件）→ React Router；`[[...slug]]` 分发逻辑已在 `features/app/base-node/helper.ts`，可平移。
2. **SSR 预取**：每页 `getServerSideProps` + `src/backend/api/rest/ssr-api.ts` → 客户端 `useQuery` 加载（sdk 已有 CSR 回退 hooks）；`withAuthSSR/ensureLogin` 登录跳转 → 前端路由守卫。
3. **i18n**：next-i18next（456 处）→ react-i18next；`packages/common-i18n` 的 JSON 文案直接复用。
4. **组件替换**：`next/link`→Link、`next/head`→react-helmet、`next/image`→img、`next/router`→新路由 hooks（约 170 处）。
5. **端点配置化**：`packages/openapi/src/axios.ts` 的 `baseURL:'/api'` 与 sdk 连接层的 `window.location.origin+'/socket'` 都假设同源——桌面端改为进程内直调（方案 A）或本地端口（方案 B）。
6. **删除**：Sentry/monitor 路由、CSP/COOP/COEP 头、affiliate/attribution 中间件（`src/proxy.ts`）。

### 4.4 迁移路线图（以方案 A 为例）

| 阶段 | 内容 | 产出 |
|---|---|---|
| P0（1-2 周） | 技术验证：跑通 `container-browser` + PGlite 的 v2 命令建表/加字段/增删改查记录/公式重算；验证 `dottea` 归档做文件格式 | 可行性 spike |
| P1（3-5 周） | de-Next：Vite+React Router 壳 + sdk 可视组件跑起来 + 新数据 hooks（record/field/view CRUD + 查询） | 可看的桌面 MVP |
| P2（3-4 周） | 宿主功能：本地附件、CSV 导入导出、回收站、undo/redo、文件夹树、设置页 | 日常可用 |
| P3（按需） | 仪表盘/图表、分享导出、AI 填充、插件 iframe、多窗口 BroadcastChannel | 完整版 |

---

## 5. 许可证与合规（务必先读）

仓库是**混合许可**（根目录 `LICENSE`）：

| 部分 | 许可 | 对二开的约束 |
|---|---|---|
| `apps/nestjs-backend`、`apps/nextjs-app` | **AGPL-3.0** + 品牌保护附加条款 | 修改后分发（含网络服务）须开源；**禁止移除/替换 Teable 品牌元素**（名称、logo、视觉识别） |
| `packages/**`（core、sdk、v2、formula、openapi、ui-lib…） | **MIT** | 可自由使用、修改、闭源商用，保留版权声明即可 |

**建议**：
- 闭源商业桌面产品 → 只依赖 `packages/**`（好在核心引擎、表格组件、v2 全家桶全在这里），壳与宿主层自写；UI 不要直接复制 `apps/nextjs-app` 的页面代码（AGPL），参照交互自行实现（组件在 MIT 的 ui-lib/sdk 里都有）。
- 若接受 AGPL → 可 fork `apps/*` 快速裁剪（方案 B），但产品须开源且保留 Teable 品牌，商业上基本等于给官方做嫁衣；如需商业授权需联系 Teable Inc.（support@teable.ai）。
- 衍生作品命名/logo 不要带 Teable（品牌附加条款明确保护）。

---

## 6. 风险与难点清单

| # | 风险 | 说明 | 缓解 |
|---|---|---|---|
| 1 | **前端数据层重接是隐藏大头** | sdk 的 hooks/model/context 与 ShareDB 文档模型深度绑定（`use-instances`、`model/*` 是 Doc 封装），换 v2 数据层不是简单换 URL | P0 先做 spike 验证接口形状；保留 grid 等纯组件层不动，只重写 hooks 层 |
| 2 | **v2 覆盖度边界** | v2 只覆盖 Table 限界上下文；附件存储、导入导出、插件、仪表盘、分享等宿主功能 v2 明确不管（有架构红线） | 按 §3.4 划清一期边界，宿主功能自写轻量版 |
| 3 | **PGlite 性能边界** | WASM Postgres 单文件，单写者、无多进程并发，数据量大时（百万行 + 大量公式重算）需压测 | P0 压测；必要时二期换嵌入式 PG 二进制（SQL 层不用改） |
| 4 | **公式双引擎一致性** | 内存求值与 SQL 下推两套实现，行为差异是上游持续修的 bug 来源 | 直接复用 `packages/core` + `formula-sql-pg`，不要自研第三套 |
| 5 | **权限 Guard 全局耦合** | v1 的 PermissionGuard 是全局 APP_GUARD，所有 controller 都过它 | 方案 A 天然绕开（不跑 NestJS）；方案 B 需留桩而非删 |
| 6 | **自动化无实现** | 本仓库只有企业版占位页 | 产品规划里删掉自动化预期，或立项自研 |
| 7 | **AGPL 传染** | 方案 B/C 分发即触发开源义务 + 品牌条款 | 商业闭源走方案 A；或取得商业授权 |
| 8 | Windows/macOS 打包差异 | sharp（图片缩略图）、worker_threads、文件路径 | 用 Tauri 自带能力替代 sharp（二期），或预编译原生依赖 |

---

## 附录 A：给不熟悉 TS/本项目读者的读码指引

- **先建立三层心智模型**：① 元数据（表/字段/视图的定义，存在 Prisma 管理的系统表里）② 记录数据（每表一张动态物理表）③ 计算与广播（改数据 → 依赖图重算 → 推送前端）。
- **TypeScript 里看到这些名词的含义**：`zod schema` = 运行时数据校验器（类似 JSON Schema）；`Prisma` = ORM（把表映射成 TS 对象）；`Knex/Kysely` = SQL 查询构造器；`NestJS` = 后端框架（Controller 接请求 → Service 干活 → Module 装配依赖）；`hooks`（useXxx）= React 的状态/副作用函数；`ports & adapters` = 接口与实现分离（v2 的骨架）；`commandBus` = 所有写操作走同一个调度器。
- **推荐阅读顺序**：`packages/core/src/models/field/constant.ts`（字段类型全景）→ `packages/v2/core/src/ARCHITECTURE.md`（v2 设计）→ `packages/sdk/src/components/grid/`（表格）→ `apps/nestjs-backend/src/features/record/computed/services/computed-orchestrator.service.ts`（计算链路）。
- **复杂度最高的三个单体**（改造时绕着走）：`sql-conversion.visitor.ts`（2.5k 行）、`field-supplement.service.ts`（2.5k 行）、`link.service.ts`（2k 行）——它们是链接字段与公式 SQL 的深水区，桌面版应该整体复用而非重写。

## 附录 B：关键配置速查（验证降级路径用）

| 环境变量 | 取值 | 作用 |
|---|---|---|
| `BACKEND_CACHE_PROVIDER` | `memory` / `sqlite` / `redis` | 缓存后端（无 Redis 可跑） |
| `BACKEND_CACHE_REDIS_URI` | `redis://...` 或不设 | 不设则队列自动用进程内本地队列 |
| `BACKEND_STORAGE_PROVIDER` | `local`（默认）/ `minio` / `s3` / `aliyun` | 附件存储 |
| `BACKEND_STORAGE_LOCAL_PATH` | 默认 `.assets/uploads` | 本地附件目录 |
| `FORCE_V2_ALL` | `true` | 强制全部走 v2 新管线 |
| `BACKEND_SKIP_NEXT_START` | `true` | 跳过内嵌 Next.js（纯 API 模式） |

---

*本文由代码静态调研生成（5 路并行探查：核心表格域 / 权限域 / 周边功能域 / 前端 SDK / v2 架构），关键结论均标注了源码路径，可按图索骥复核。*
