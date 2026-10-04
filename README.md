# teable-desktop

Teable 桌面端二开仓库 —— fork 自 [teableio/teable](https://github.com/teableio/teable) `develop@5ef223888`（v1.10.0，**完整 git 历史已保留**，上游原始说明见 [README.teable.md](./README.teable.md)）。

## 目标架构（二开方向）

- **切 Redis**：缓存 → sqlite/memory，任务队列 → 进程内本地队列（v1 自带降级路径，纯配置）
- **切 ShareDB**：实时 → v2 `BroadcastChannel`（多窗口）/ `Noop`，前端数据层改走 v2 总线
- **切 PostgreSQL 服务 → PGlite**：数据即本地目录（v2 适配器已存在，e2e 默认就在用）
- **测试环境 Windows 原生直跑，零 Docker**（本 fork 已移除 `dockers/`、`Makefile`、`.github/` 等 CI/流水线与组织运营文件）

规划文档见 [`docs/`](./docs/)：`teable-desktop-analysis.md`（功能地图/裁剪清单）、`desktop-rewrite-roadmap.md`（v1→v2 合并路线）、`desktop-target-structure-and-modules.md`（终态结构）、`infra-first-switch.md`（去服务化=新阶段 0）。

## 目录结构

```
apps/nestjs-backend/   后端宿主（AGPL）：REST + WS + 内嵌 Next.js
apps/nextjs-app/       前端（AGPL）：页面薄壳，业务在 src/features/**
packages/              共享层（MIT）：core/formula/sdk/openapi/ui-lib/icons/common-i18n/db-*-prisma
packages/v2/           v2 业务内核（MIT）：core + PGlite/仓储/实时适配器 + 组合根 + e2e 安全网
plugins/               官方插件宿主（@teable/plugin）
```

## 常用命令

```bash
pnpm install                          # pnpm 按 packageManager 自动切 9.13.0；Node 22 由 .npmrc 管理
pnpm g:typecheck                      # 全仓 typecheck
pnpm build:v2                         # 构建 v2 全家（tsdown）
pnpm -F @teable/v2-e2e test-e2e       # v2 内核测试（PGlite memory://，无需数据库、无需 Docker）
pnpm -F @teable/core test-unit        # 单测
```

### 启动开发服务（后端热重载，自动带起 Next.js）

```bash
cd apps/nestjs-backend && pnpm dev    # → http://localhost:3000
```

## 本地零容器启动（已跑通 ✅）

**无 Docker / 无 Redis / 无 PostgreSQL 服务**——数据库是 PGlite（WASM PG 18.3，数据落 `.data/teable`），缓存是 sqlite，任务队列走进程内本地队列。三个终端：

```bash
# ① 桥（常驻，等价于本地 PG 服务）
pnpm pglite:bridge

# ② 首次初始化（迁移已入库可跳过；注意 NODE_ENV 前缀，否则 .env.development.local 不生效）
NODE_ENV=development pnpm -F @teable/db-main-prisma prisma-migrate deploy --schema ./prisma/postgres/schema.prisma
NODE_ENV=development pnpm -F @teable/db-data-prisma prisma-migrate deploy --schema ./prisma/schema.prisma

# ③ 后端（内嵌 Next.js）→ http://localhost:3000
cd apps/nestjs-backend && pnpm dev
```

首个注册用户自动成为实例管理员（无 SMTP 也能注册登录，邮件未配置时静默 no-op）。

### 环境与关键机制（`apps/nextjs-app/.env.development.local`）

后端按 `.env.development.local` → `.env.development` → `.env` 顺序加载（prisma CLI 命令需 `NODE_ENV=development` 前缀才读取 `.local` 覆盖）。

| 机制 | 说明 |
|---|---|
| `PRISMA_DATABASE_URL → 127.0.0.1:5544` + `connection_limit=1` | 全栈共用一条桥连接。**必须为 1**：pglite-socket 多路复用器无法安全交错多连接的扩展协议（并发时挂死或 `portal "" does not exist`） |
| `DATABASE_POOL_IDLE_TIMEOUT_MS=0` | 池连接永不空闲关闭——多路复用器会弄丢与活跃查询竞争的握手，运行期绝不能重建连接 |
| `BACKEND_CACHE_REDIS_URI=`（空） | 无 Redis：缓存 sqlite、队列本地化、BullMQ 根模块不注册、computed-outbox 唤醒走进程内 publisher |
| `BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ENABLED=false` | BYODB 迁移 worker 零延迟重试会占死唯一连接（本就是裁剪清单里的 SaaS 设施） |
| `OTEL_EXPORTER_OTLP_ENDPOINT=`（空） | 静音无收集器的导出尝试 |

**事务内查询纪律**：`prismaService.$tx` 内部发起的引擎查询必须走 `prismaService.txClient()`（路由到 CLS 事务客户端），否则会向池要第二条连接而自死锁（唯一连接正被事务持有）。上游多数代码已遵守此惯例，`SettingModel` 是漏网之鱼（已修）。

**调试开关**：`PG_POOL_DEBUG=1` 输出池借还 + prisma 适配器每条 SQL；桥用 `PGLITE_DEBUG=1` / `PGLITE_INSPECT=1` / `PGLITE_PORT` / `PGLITE_DATA_DIR` / `PGLITE_MAX_CONNECTIONS`。

**已知限制**：强杀后端会在桥上留下半开连接（handler 计数只增不减），多次重启后若后端连不上桥，重启桥即可；附件 avatar URL 含 Windows 反斜杠（上游小瑕疵）。

## 许可（重要）

本仓库 fork 了 teable 的 `apps/*`（**AGPL-3.0 + 品牌保护附加条款**）：

- 分发（含以网络服务形式提供）须以同许可开源；
- **不得移除/替换 Teable 品牌元素**（名称、logo、视觉识别）；
- 商业闭源需取得 Teable Inc. 授权（support@teable.ai）。

`packages/**`（含 v2 全家）为 MIT。

## 上游同步

- `upstream` remote 指向本地镜像 `../teable`（可 `git remote set-url upstream https://github.com/teableio/teable` 切到 GitHub）；
- fork 基线：`5ef223888`；
- 同步方式：`git fetch upstream && git diff 5ef223888..upstream/develop -- <路径>` 后按需重放；
- fork 首提交剥离了 CI/流水线与组织运营文件（`.github/`、`dockers/`、`Makefile`、`renovate`/`crowdin` 等），同步时注意这些路径不存在。
