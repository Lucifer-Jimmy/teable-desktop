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

> 当前默认环境仍指向 docker PostgreSQL/Redis（见下）；无 Docker 路线按下节推进。

### 数据库初始化（原 `make postgres.mode` 的等价命令）

```bash
pnpm -F @teable/db-main-prisma prisma-generate
pnpm -F @teable/db-main-prisma prisma-migrate deploy --schema ./prisma/postgres/schema.prisma
pnpm -F @teable/db-data-prisma prisma-generate
pnpm -F @teable/db-data-prisma prisma-migrate deploy --schema ./prisma/schema.prisma
```

### 环境变量

后端按 `apps/nextjs-app/.env.development.local` → `.env.development` → `.env` 顺序加载（提交的 `.env.development` 含 docker PG/Redis 默认值）。本地覆盖一律写在 `apps/nextjs-app/.env.development.local`。

**去 Redis 第 0 步**（纯配置，见 `docs/infra-first-switch.md`）：

```ini
# apps/nextjs-app/.env.development.local
BACKEND_CACHE_PROVIDER=sqlite
BACKEND_STORAGE_PROVIDER=local
# 不设 BACKEND_CACHE_REDIS_URI → 队列/会话/undo 自动走本地
```

**PGlite 桥**（第 1 步 spike）：后端进程内起 PGlite + socket server，`PRISMA_DATABASE_URL` 指向 `127.0.0.1:<port>`，全程无 Docker——详见 `docs/infra-first-switch.md` §2。

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
