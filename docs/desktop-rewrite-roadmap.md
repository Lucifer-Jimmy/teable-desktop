# Teable 桌面端二开执行路线图
# ——v1/v2 合并改造 · 前端冻结复用 · 边开发边调试

> 生成时间：2026-10-03 ｜ 姊妹篇：`docs/teable-desktop-analysis.md`（功能地图与裁剪清单）
> 前提约束：**① 前端样式尽量不变、最大化复用现有代码；② 接受 v1/v2 大改并尽可能合并；③ 全程可调试、随时能看到最新效果。**

---

## 0. 三条铁律（整个二开期间不要违背）

### 铁律 1：契约冻结 → 前端零改动
前端与后端之间**只有三条通道**，把它们冻住，整个前端（约 1100 个文件、全部样式）就不需要动：

| 通道 | 内容 | 冻结物 |
|---|---|---|
| REST | 约 430 个接口（`packages/openapi` 的 URL + 请求/响应结构） | **URL 路径和 DTO 形状一个都不要改** |
| ShareDB | table/field/view/record 的实时文档协议（op 形状） | doc 结构、op-builder 不变 |
| penpal | 插件 iframe 桥 | 二期再说 |

> 含义：大改发生在**接口后面的实现**。前端调 `/table/{tableId}/record`，你的新内核照样在同样的 URL 后面响应。这就是"样式不动、代码复用"的结构性保证。

### 铁律 2：合并方向只有一个——v2 当内核，v1 当外壳
```
改造前：  前端 ──REST/ShareDB──► NestJS features/*（v1 巨型服务：Prisma+Knex 直写）
                              └─ 灰度开关 ──► packages/v2（新内核，已迁移约 90 个特性）

改造后：  前端 ──REST/ShareDB──► 薄控制器（URL 翻译层）──► v2 commandBus/queryBus（唯一内核）
                              packages/core  = 前后端共享类型层（保留，前端依赖它）
                              ❌ v1 计算/存储实现删除（features/calculation、record/computed 旧管线等）
```
- `packages/v2/core`（domain/commands/queries/ports）= **唯一业务内核**
- `apps/nestjs-backend` 的 features 只留「薄壳」：controller + 参数翻译 → 调 v2 总线 → 结果映射回旧 DTO
- `packages/core`（FieldType 枚举、zod schema、op-builder）= **保留不动**，它是前端 SDK 的依赖，兼任前后端契约类型
- v1 的 `*OpenApiV2Service` 桥接模式（`field-open-api-v2.service.ts` 等）就是官方迁移样板——你的工作很大程度是**把这套模式推进到 100% 覆盖**（官方已做约 90 个特性点）

### 铁律 3：垂直切片 + 随时可回归
不要"先重写完所有后端再联调"。每一切片 = 一个端点组（如"字段 CRUD"）从 REST 到 v2 内核打穿 → 立刻在界面上看效果 → 跑冒烟清单。整个过程产品始终可用。

---

## 1. 第一步：搭好开发调试环境（第 0 周，1-2 天）

### 1.1 启动（Windows 本机）

```bash
# 1) 安装依赖（Node 22 + pnpm 9，corepack enable）
corepack enable && pnpm install

# 2) 起数据库（docker）：PostgreSQL + Redis
make docker.up teable-postgres teable-cache     # 或 make switch-db-mode 交互选择
# 默认连接：postgres://teable:teable@127.0.0.1:5432/teable

# 3) 初始化数据库结构
make postgres.mode        # prisma-generate + prisma-migrate deploy

# 4) 启动开发服务（★ 一条命令：后端热重载 + 自动内嵌 Next.js 热重载 + WebSocket）
cd apps/nestjs-backend
pnpm dev                  # webpack watch，改后端代码自动重启
# 打开 http://localhost:3000（Next.js 由后端进程自动带起，前端改动也热更新）
```
> 依据：README 明示 "you just need to start backend, it will start next server for frontend automatically, file change will be auto reload"；`next.service.ts` 以 `dev: true, turbopack: true` 内嵌 Next。

### 1.2 调试工具箱（边开发边看结果的手段）

| 手段 | 用法 | 看什么 |
|---|---|---|
| 热重载 | `pnpm dev`（常开） | 改代码即生效，浏览器刷新看结果 |
| 后端断点 | `pnpm start-debug`（Node inspector 9229），VSCode "Attach to Node" | 计算链路/命令处理器逐行调 |
| v1/v2 归因 | 浏览器 Network 里看响应头 **`x-teable-v2: true / reason / feature`**（`features/canary/interceptors/v2-indicator.interceptor.ts`） | 每个请求走的是旧管线还是新管线 |
| 强制 v2 | 环境变量 `FORCE_V2_ALL=true` 再 `pnpm dev` | 全量走 v2，暴露缺口 |
| v2 单测/集成 | `pnpm dev:v2`（packages/v2 watch 构建）；`packages/v2/e2e` 默认跑 **PGlite**（`memory://`），无需数据库 | 内核改动的正确性 |
| 后端 e2e | `cd apps/nestjs-backend && pnpm test-e2e`（有 `FORCE_V2_ALL=true` 变体） | 端点级回归 |
| 前端单测 | `cd apps/nextjs-app && pnpm test-unit` / sdk 同理 | UI 逻辑 |
| SQL 观察 | Knex/Prisma 日志；PG 里 `\dt` 看动态表（命名即 `db_table_name`） | 物理存储验证 |
| ShareDB 观察 | 浏览器控制台 + `packages/sdk/src/context/use-instances/` 打日志 | 实时 op 流 |

### 1.3 冒烟清单（每个切片完成后必跑，10 分钟）

```
□ 建 base → 建表 → 五种字段（文本/数字/单选/日期/勾选）增删改
□ 输入/修改/删除记录，刷新页面数据仍在（持久化）
□ 公式字段：引用文本/数字列，改源值公式跟着变（计算链路）
□ 链接字段（双向）+ Lookup：跨表引用与级联更新
□ 视图筛选/排序/分组/隐藏字段
□ 视图底部聚合统计（count/sum/avg）
□ 撤销/重做
□ CSV 导入 + CSV 导出
□ 复制粘贴多单元格（选区）
□ 回收站恢复
□ （可选）两个浏览器窗口同开，看实时同步
```

---

## 2. 二开顺序（五阶段）

> **⚠ 策略更新（2026-10-04）**：基础设施本地化（原阶段 8）**提前为新阶段 0**——先砍 Redis/MinIO、PG 切 PGlite，此后全程在轻量目标栈上开发。执行细节见 `docs/infra-first-switch.md`。下文阶段 1–7 / 9–11 的内容与顺序仍然有效，仅"阶段 8"被吸收为收尾项。

### 阶段 1：摸清 v2 覆盖缺口（约 1 周）
**目标：得到一张"哪些接口还没接 v2"的清单，作为后续工作量依据。**

1. 以 `FORCE_V2_ALL=true` 启动，跑冒烟清单，记录每个请求的 `x-teable-v2` 头（有 `reason` 的就是回落 v1 的）。
2. 读两个样板搞懂桥接模式（半天）：
   - `apps/nestjs-backend/src/features/canary/canary.service.ts`（灰度判定）
   - `apps/nestjs-backend/src/features/field/open-api/field-open-api.controller.ts` + `field-open-api-v2.service.ts`（同一 URL 二选一 service 的标准写法）
3. 对照 `packages/openapi/src/admin/setting/update.ts` 的 `V2Feature` 枚举（约 90 项）勾出已完成/未完成。
4. 阅读 `packages/v2/core/src/ARCHITECTURE.md` + 一个 command 的完整调用链（如 `CreateFieldCommand`），熟悉 domain/commands/ports 分层。

**产出**：缺口表（端点 → 缺 v2 桥 / v2 命令是 Noop / 逻辑仍在 v1 service）。

### 阶段 2：补齐 v2 迁移，全功能跑在新内核上（3-6 周，核心战役）
**目标：REST 响应 100% 由 v2 内核产生（`x-teable-v2: true` 全绿）。**

按依赖顺序做垂直切片（每片 1-3 天，先样板后批量）：

| 序 | 切片 | 涉及端点 | 迁移去向（v2 位置） |
|---|---|---|---|
| 1 | **字段 CRUD**（先单行文本/数字，再全 20 类） | `/table/{id}/field/*` | `packages/v2/core/src/commands/*Field*` + `domain/table/fields/` |
| 2 | **记录 CRUD + 查询** | `/table/{id}/record/*` | `commands/*Record*`、`queries/*Record*` |
| 3 | **计算链路**（公式/Lookup/Rollup 重算） | 隐式（写记录时） | `domain/computed/` + `adapter-table-repository-postgres` |
| 4 | **视图**（filter/sort/group/列宽/共享） | `/table/{id}/view/*` | `commands/UpdateView*` |
| 5 | **表管理**（建表/改名/复制/删除） | `/table/*` | `commands/CreateTable*` 等 |
| 6 | **聚合统计** | `/table/{id}/aggregation/*` | `queries/*Aggregate*` |
| 7 | **导入/导出/选区/undo** | `api/import`、`api/export`、`api/table/{id}/selection`、undo | v2 `import`、selection 桥、`adapter-undo-redo-keyv` |

每片的**手术步骤**（以"字段 CRUD"为例）：
1. 读现有 v1 实现（`features/field/open-api/field-open-api.service.ts`）→ 理解入参/出参/副作用；
2. 确认 v2 command/query 已覆盖 → 不够就在 `packages/v2/core` 补（**这是你"大改 v2"的主战场**：补命令、删 Noop、必要时改 domain）；
3. 控制器保持 URL/DTO 不动，service 里改为调 `commandBus.execute(...)`（照抄 `field-open-api-v2.service.ts` 的映射写法）；
4. 保持 ShareDB 广播兼容：v2 事件 → 旧 op 形状的桥在 `features/v2/v2-record-history.service.ts`、`v2-view-compat.service.ts` 等 compat 服务里——**这些先保留**；
5. 跑冒烟清单 + `x-teable-v2` 确认全绿 + 相关 e2e。

> 提示：v2 e2e（`packages/v2/e2e`，16 万行测试）是你的安全网，内核改动先写/改那里的用例，再接线。

### 阶段 3：删除 v1 内核，完成合并（1-2 周）
**目标：仓库里只剩一套业务实现。**（这就是"v1/v2 尽可能合并"的收官）

删除/收编清单（确认无引用后删，`pnpm typecheck` 兜底）：
```
apps/nestjs-backend/src/features/
  calculation/          旧计算编排（已被 v2 domain/computed 取代）
  record/computed/      旧计算服务（orchestrator/evaluator/collector）
  record/record-modify/ 旧写路径（被 v2 commands 取代）
  record/query-builder/ 旧查询 SQL 生成（被 v2 adapter-table-query-ops 取代）
  field/field-calculate/ 旧字段依赖维护（被 v2 field-dependency-core 取代）
  db-provider/          仅 v1 用的 SQL 方言部分
```
- 元数据读写若还有 Prisma 直查的（User/Setting 等宿主表），暂时保留（那是宿主域，桌面版后面再裁）；
- `packages/core` 与 `packages/v2/core` 的关系定案：**core = 前端共享类型层，v2-core = 唯一内核**，两边重复的校验逻辑以 v2 为准、core 只留类型/schema；
- ShareDB 保留（`adapter-realtime-sharedb` 已能接 v2），前端实时层零改动。

### 阶段 4：基础设施降级（1-2 周，可与阶段 5 并行）
**目标：开发态 → 单机桌面态，甩掉外部服务。**

| 步骤 | 做法 | 验证 |
|---|---|---|
| 1. 队列/缓存去 Redis | 不设 `BACKEND_CACHE_REDIS_URI`，`BACKEND_CACHE_PROVIDER=sqlite` | 冒烟清单；导入仍可用 |
| 2. 附件本地化 | `BACKEND_STORAGE_PROVIDER=local`（已是默认） | 上传/预览/缩略图 |
| 3. **PG → PGlite**（最重一步） | 推荐路线：v2 的 SQL 层已可在 PGlite 跑（e2e 就在用）→ 把剩余宿主 Prisma/Knex 调用迁到 v2 仓储，或用 PG 协议桥（pg-gateway）让 Knex 连 PGlite | `packages/v2/e2e` 全绿 + 冒烟清单 + 百万行压测 |
| 4. 无 Docker 启动 | 数据库初始化自动化（v2 `adapter-repository-postgres/src/db/schema.ts` 的 `ensureSchema` 可自举） | 干净机器从零启动 |

### 阶段 5：桌面壳 + SaaS 裁剪（1-2 周起，可持续）
1. **Electron 壳**：主进程 `spawn`（或 in-process）启动 nestjs-backend → `BrowserWindow.loadURL('http://127.0.0.1:<随机端口>')` → preload 暴露文件对话框/托盘/自动更新；开发期直接连 `pnpm dev` 的端口（改代码即见效果，**这就是"边开发边调试最终形态"的桌面版**）。
2. 按分析文档 §3.3 删 SaaS 模块（auth/OAuth/邀请/邮件/冷存/审计…），用冒烟清单 + 冒烟清单外的分享/权限场景做回归。
3. 权限降级为桩（注意 `PermissionGuard` 是全局 APP_GUARD，用"恒定 owner"桩替换，别硬删）。

---

## 3. 冻结区 / 手术区（文件级，防止误伤）

| 区域 | 路径 | 规则 |
|---|---|---|
| 🧊 **冻结区**（基本不动） | `apps/nextjs-app/src/features/app/**`（blocks/components 样式与布局）、`packages/sdk/src/components/**`（grid/editor）、`packages/ui-lib/**`、`packages/common-i18n/**` | 只允许改 bug 级问题；样式零改动 |
| 🧊 **契约冻结** | `packages/openapi/**` 的 URL 常量与 schema（可加字段，不可改形状） | 前后端共享契约 |
| 🔪 **手术区**（主战场） | `apps/nestjs-backend/src/features/**`（业务服务改薄）、`packages/v2/**`（补命令/删 Noop/换 adapter） | v1→v2 合并发生地 |
| 🔧 **按需微调** | `packages/sdk/src/hooks/`、`context/`、`model/`（数据层）、`apps/nextjs-app/src/lib/**`（SSR 封装） | 仅当某数据能力 v2 无法经 ShareDB 兼容层提供时才动，动时保持 hook 签名不变 |
| 🗑️ **待删** | 见分析文档 §3.3（SaaS 模块 + v1 旧内核） | 阶段 3/5 分批删 |

---

## 4. 每日工作流（推荐节奏）

```
上午：选定今日切片（一个端点组）
  1) 在 packages/v2/core 补/改 command + 在 packages/v2/e2e 写用例（PGlite 上跑，秒级反馈）
  2) 用例绿 → 改薄控制器接 commandBus
  3) pnpm dev 热重载 → 浏览器操作验证 → x-teable-v2 头确认
下午：
  4) 跑冒烟清单 + 相关 backend e2e
  5) 有 ShareDB 影响的：开双窗口看实时同步
  6) 提交一个切片（commit 领域：feat(v2-field): migrate create/update to command bus）
```
调试优先级：**v2 e2e（最快、无依赖）→ 热重载界面验证（最直观）→ start-debug 断点（疑难杂症）**。

---

## 5. 风险与技巧

| 风险 | 缓解 |
|---|---|
| v2 命令与 v1 行为有细节差异（如错误码、边界值） | 切片前先抄 v1 的 e2e 断言到 v2 e2e 做行为基线；错误映射统一在 `features/v2/v2-http-error.ts` |
| ShareDB op 兼容层被误删 | 阶段 2 全程保留 `features/v2/*compat*`；前端 `use-instances` 打日志观察 op 形状 |
| 双管线并存期改一处漏一处 | 靠 `x-teable-v2` 头清单化验收；阶段 3 结束前不开新功能 |
| PGlite 性能/并发边界 | 阶段 4 前压测；必要时开发态继续用真 PG，仅发行版切 PGlite（适配器是同一套） |
| 不熟 TS/仓库，改动打偏 | 所有切片先"读 v1 → 照抄样板 → 再改"，样板就是 `field-open-api-v2.service.ts`；复杂单体（`sql-conversion.visitor.ts` 等三个）只复用不重写 |
| 许可（AGPL + 品牌条款） | fork `apps/*` 即传染：分发须开源、不得移除 Teable 品牌；商用闭源请先取得授权或改走"只用 packages/*（MIT）"路线 |

---

## 6. 里程碑自检表

| 里程碑 | 标志 | 大约周次 |
|---|---|---|
| M0 环境跑通 | `pnpm dev` 后完成冒烟清单 | 第 0 周 |
| M1 缺口清单 | 出表并评审 | 第 1 周 |
| M2 字段/记录/视图切片 | 这三组 `x-teable-v2: true` | 第 2-4 周 |
| M3 全量 v2 | 冒烟清单全绿且无 v1 回落 | 第 5-7 周 |
| M4 v1 内核删除 | `pnpm typecheck` + e2e 全绿，仓库只剩一套实现 | 第 8-9 周 |
| M5 无 Redis/本地存储单机跑 | 干净机器无 Docker 启动成功 | 第 10-11 周 |
| M6 桌面壳 MVP | Electron 安装包完成冒烟清单 | 第 12 周起 |

---

*执行中每个阶段的具体技术决策（比如某命令放 v2 domain 还是宿主层），可对照 `packages/v2/core/src/ARCHITECTURE.md` 的限界上下文红线：Table 域进 v2-core，宿主导航/账号/附件存储不进。*
