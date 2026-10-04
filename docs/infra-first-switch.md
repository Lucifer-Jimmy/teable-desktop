# 去服务化执行方案（新阶段 0）——尽早切换 PGlite / 本地缓存
> 生成时间：2026-10-04 ｜ 策略调整：**基础设施本地化从原阶段 8 提前到第 0 阶段**，此后所有开发都发生在轻量目标栈上。
> 姊妹篇：`desktop-rewrite-roadmap.md`（总路线，本文替代其阶段顺序）、`desktop-target-structure-and-modules.md`（模块清单）。

## 0. 策略意图

先砍掉重量级线上服务（PostgreSQL 服务 / Redis / MinIO / BullMQ），换成本地轻量实现，**让后续每一行代码都直接在终态环境上开发**。收益：
- 尽早暴露 PGlite 路线的真实坑（fail fast），避免最后阶段翻车；
- 开发环境归零：`pnpm dev` 一条命令，无 Docker；
- 桌面版目标形态从第一天起就是「可运行的」。

**总工作量预估：1 周内见分晓**（第 0 步当天完成，第 1 步 1-3 天 spike + 决策门）。

---

## 1. 第 0 步：砍 Redis + MinIO（当天，零风险，纯配置）

这两个本来就有官方降级路径，改环境变量即可，**不改任何代码**。

```ini
# apps/nestjs-backend/.env.development.local（新建/追加）

# 缓存：redis → sqlite（重启不丢）或 memory
BACKEND_CACHE_PROVIDER=sqlite

# 不设置 BACKEND_CACHE_REDIS_URI
# → 事件队列自动回退进程内本地队列（event-job/fallback/local-queue.provider.ts）
# → 会话/锁/undo 栈自动走本地

# 附件存储：local 已是默认，显式声明防意外
BACKEND_STORAGE_PROVIDER=local
BACKEND_STORAGE_LOCAL_PATH=.assets/uploads
```

**验证清单**（重点测队列相关功能）：
- [ ] 登录/会话保持
- [ ] CSV 导入（原 BullMQ 分片路径 → 本地队列）
- [ ] 附件上传/缩略图/预览
- [ ] undo/redo
- [ ] 改单元格 → 公式重算（computed-outbox 的本地队列驱动）

**验收**：`docker ps` 里只剩 postgres；功能冒烟全绿。

---

## 2. 第 1 步：PG → PGlite（1–3 天 spike，核心战役）

### 2.1 架构：wire 桥（不动 Prisma/Knex 一行 SQL）

```
┌─ NestJS 宿主进程 ──────────────────────────────────────┐
│  启动时：                                               │
│    PGlite.create('./.data/teable')   ← 数据即本地目录   │
│    PGliteSocketServer({ port: 5544 }) ← 伪造成 PG 服务器 │
│                                                        │
│  Prisma  ──连接──► postgresql://127.0.0.1:5544/...      │
│  Knex    ──连接──► 同上（connection_limit=1）           │
│  v2 内核 ──之后逐步走原生 pglite adapter（不经桥）        │
└────────────────────────────────────────────────────────┘
```

### 2.2 具体改动

| # | 动作 | 位置 |
|---|---|---|
| 1 | 加依赖：`@electric-sql/pglite-socket`（版本与 `@electric-sql/pglite@0.3.14` 配套，查该包 README 对应版本） | `apps/nestjs-backend/package.json` |
| 2 | 新建启动件：进程内起 PGlite + SocketServer | 新建 `apps/nestjs-backend/src/infra/pglite/pglite-bootstrap.ts`，在 `bootstrap.ts`/`app.module` 最早处调用 |
| 3 | 连接串全部指向桥端口，且限单连接 | `PRISMA_DATABASE_URL=postgresql://127.0.0.1:5544/teable?schema=public&connection_limit=1`；`PRISMA_META_DATABASE_URL`、data 库 URL 同理（清单见 `configs/env.validation.schema.ts`） |
| 4 | 迁移照跑 | `pnpm -F @teable/db-main-prisma prisma-migrate deploy --schema ./prisma/postgres/schema.prisma`（PGlite 是真 PG 内核，迁移 SQL 通用） |
| 5 | 数据目录进 .gitignore | `.data/` |

```ts
// pglite-bootstrap.ts 示意（API 以所装版本的 README 为准）
import { PGlite } from '@electric-sql/pglite';
import { PGliteSocketServer } from '@electric-sql/pglite-socket';

export async function startPgliteServer() {
  const db = await PGlite.create(process.env.PGLITE_DATA_DIR ?? './.data/teable');
  const server = new PGliteSocketServer({ db, host: '127.0.0.1', port: 5544 });
  await server.start();
  return { db, server };
}
```

### 2.3 三个必盯风险点（spike 的验证重点）

| 风险 | 为什么会出事 | 测试方法 |
|---|---|---|
| **① Prisma 事务内嵌套 Knex 写** | v1 计算管线是 `prisma.$transaction` 包着 Knex 批量写（`calculation/batch.service.ts` 的 `tx.rawOpMaps` 模式）；单连接桥下连接互等可能**死锁** | 冒烟重点：改单元格→公式/链接级联重算；并发快速编辑 10 次 |
| ② 并发被串行化 | `connection_limit=1` 下多请求排队 | 大 CSV 导入 + 同时浏览界面，观察是否变慢到不可用（慢可接受，错不可接受） |
| ③ 迁移/DDL 兼容 | 极少数扩展语句 PGlite 未编译 | 直接跑 `prisma-migrate deploy` + 动态建表/改字段 |

### 2.4 决策门（spike 结束时三选一）

```
冒烟 10 条全绿 + 随机操作 30 分钟无锁死？
├─ ✅ 通 ──► 【A】正式采用：后续全部开发在无服务栈上进行，Docker 退场
│            （随 v1 删除推进，Prisma/Knex 调用逐步换成 v2 原生 pglite adapter，
│              桥的负担越来越小，最终可去掉桥）
│
├─ ⚠️ 卡在风险①（事务互锁）──► 【B】过渡备胎：嵌入式真 PG 二进制
│            （embedded-postgres 之类：零 SQL 改动、原生并发，体积+30~50MB）
│            v2 仍走原生 pglite adapter；等 v1 事务重灾区删掉后再回到桥/纯 pglite
│
└─ ⚠️ 卡在风险③/怪问题 ──► 【C】以删代修：把出问题的 v1 事务重灾区
             （batch.service / link.service）提前换成 v2 命令，
             用「删旧代码」消灭桥的对手方，而不是修桥
```

> 无论选哪个，**v2 内核开发不受影响**：`packages/v2/e2e` 默认就跑 PGlite（`memory://`），零服务。

---

## 3. 修订后的总顺序

```
★ 新阶段 0：去服务化（本文，1 周内）
     第0步 砍 Redis/MinIO（当天）→ 第1步 PGlite 桥 spike → 决策门 A/B/C
     阶段 1：字段模块（内核+桥）      ┐
     阶段 2：记录模块                 │ 全程在轻量目标栈上开发
     阶段 3：计算模块                 │ （无 Docker / 无 Redis / 无 MinIO）
     阶段 4：视图与表                 │
     阶段 5：实时兼容                 ┘
     阶段 6：周边（附件/导入导出/回收站）
     阶段 7：删 v1 内核（合并收官）
★ 原阶段 8「基础设施本地化」→ 被本方案吸收，仅剩收尾：
     - PGlite 正式化：去桥，v2 全部走原生 adapter-db-postgres-pglite
     - schema 自举（ensureSchema）、首启初始化、数据目录规范
     阶段 9：桌面壳
     阶段 10：SaaS 裁剪
     阶段 11：打磨
```

内核模块内部顺序（字段→记录→计算→视图表→实时）**不变**——那是依赖关系决定的。

---

## 4. 新的日常开发形态（去服务化完成后）

```bash
# 一个终端搞定一切，无 Docker：
cd apps/nestjs-backend
pnpm dev                      # 后端(内嵌 PGlite) + Next.js 热重载

# 内核迭代（不需要起宿主）：
cd packages/v2/e2e && pnpm test-e2e
```

调试手段不变：热重载 → Network/`x-teable-v2` 头 → v2 e2e → `pnpm start-debug` 断点。

---

## 5. 与许可/终态的关系

- 本阶段全部改动集中在 `apps/nestjs-backend/src/infra/**` 与环境配置，不动冻结区、不动业务语义；
- PGlite 数据目录（`.data/teable`）将来就是桌面版的「用户数据文件」雏形——顺手把「数据目录可配置」做进配置（桌面设置页要用）；
- 桥是过渡件，终态是 v2 原生 pglite adapter 直连（`container-node-test` 已支持 `pglite://` 协议识别，浏览器侧 `container-browser` 同款）。
