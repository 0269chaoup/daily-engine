# daily-engine

Obsidian 日记编排引擎 CLI —— 基于事件源的日记系统，支持与 work-engine 双向桥接。

> 消除时间维度与业务维度的数据孤岛，实现任务 Single Source of Truth。

## 核心理念

- **日记 SSOT** 在 `20-Daily/` 目录（按 ISO 周组织）
- **任务 SSOT** 在 `Work/` 目录（通过 work-engine 管理）
- **daily-engine** 作为编排层，负责时间线事件记录和跨引擎调度
- Task frontmatter 使用生命周期字段（`_at`/`_log`），Dataview 可 O(1) 查询

## 安装

```bash
# 在项目目录下
npm install
npm run build

# 全局链接（可选）
npm link
```

安装后即可使用 `daily-engine` 命令。

## 全局选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--vault <path>` | Obsidian vault 根目录 | `$OBSIDIAN_VAULT` 或当前目录 |
| `--llm <provider>` | LLM 提供商类型：`agent` / `api` | `agent` |
| `--api-provider <name>` | API 提供商：`anthropic` / `openai` | `anthropic` |
| `--model <name>` | LLM 模型名称 | `claude-sonnet-4-6` |
| `--api-key <key>` | API 密钥 | 环境变量 `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY` |
| `--base-url <url>` | 自定义 API 基础 URL（用于代理） | — |
| `--verbose` | 输出详细日志 | `false` |

## 命令速查

### `init` — 初始化今日日记

在 `20-Daily/` 下创建当日日记文件（含 frontmatter 和基础结构）。

```bash
daily-engine init
daily-engine init --date 2026-06-01
```

| 选项 | 说明 |
|------|------|
| `--date <YYYY-MM-DD>` | 指定日期，默认今天 |

### `log` — 追加日志事件

向日记追加一条带时间戳的事件记录，支持关联任务和项目。

```bash
daily-engine log "完成 API 接口开发"
daily-engine log "修复登录 bug" --task "用户认证模块"
daily-engine log "代码审查" --project "daily-engine" --icon "✅"
```

| 选项 | 说明 |
|------|------|
| `-t, --task <title>` | 关联任务标题（添加双向链接） |
| `-p, --project <name>` | 关联项目名称 |
| `--date <YYYY-MM-DD>` | 指定日期 |
| `--icon <icon>` | 事件图标，默认 `📝` |
| `--tag <tag>` | 附加标签（可重复使用） |

### `task` — 创建任务

在日记中记录任务事件，同时通过 work-engine 在 `Work/` 中创建对应任务文件。

```bash
daily-engine task "重构认证模块"
daily-engine task "数据迁移" --project infra --status "🔥 In Progress"
```

| 选项 | 说明 |
|------|------|
| `--date <YYYY-MM-DD>` | 指定日期 |
| `--status <status>` | 初始状态，默认 `🌱 Planned` |
| `--group <name>` | 任务分组（可重复使用） |

### `complete` — 标记任务完成

在日记中追加完成事件，更新任务状态为完成。

```bash
daily-engine complete "重构认证模块"
daily-engine complete "数据迁移" --message "已通过所有测试"
```

| 选项 | 说明 |
|------|------|
| `--date <YYYY-MM-DD>` | 指定日期 |
| `--message <msg>` | 完成消息，默认 `任务完成` |

### `block` — 阻塞任务

```bash
daily-engine block "数据迁移" --reason "等待上游接口"
```

| 选项 | 说明 |
|------|------|
| `--reason <msg>` | 阻塞原因 |
| `--date <YYYY-MM-DD>` | 指定日期 |

### `unblock` — 解除阻塞

```bash
daily-engine unblock "数据迁移"
```

| 选项 | 说明 |
|------|------|
| `--date <YYYY-MM-DD>` | 指定日期 |

### `today` — 今日概览

汇总当日所有事件，输出 Markdown 摘要。

```bash
daily-engine today
daily-engine today --date 2026-06-01
```

### `week-review` — 周复盘

汇总指定 ISO 周的所有日记，生成周复盘报告并写入 vault。

```bash
daily-engine week-review
daily-engine week-review --date 2026-06-01
daily-engine week-review --force   # 覆盖已有复盘
```

| 选项 | 说明 |
|------|------|
| `--date <YYYY-MM-DD>` | 目标周内的任意日期 |
| `--force` | 覆盖已有周复盘文件 |

### `link` — 双链校验

检查日记与任务之间的双向链接完整性。

```bash
daily-engine link
daily-engine link --project daily-engine
daily-engine link --fix   # 自动修复缺失的 created_log 字段
```

| 选项 | 说明 |
|------|------|
| `-p, --project <name>` | 限定项目范围 |
| `--fix` | 自动修复缺失字段 |

### `sync` — 同步 checkbox 到工作任务

读取日记中的 checkbox 状态，同步到 `Work/` 中对应的工作任务。

```bash
daily-engine sync
daily-engine sync --date 2026-06-01
daily-engine sync --dry-run   # 预览模式，不实际修改
```

| 选项 | 说明 |
|------|------|
| `--date <YYYY-MM-DD>` | 指定日期 |
| `--dry-run` | 预览模式，仅显示将要同步的内容 |

## 架构概览

```
daily-engine/
├── src/
│   ├── index.ts               # CLI 入口（commander 注册全局选项 + 子命令）
│   ├── commands/
│   │   ├── init.ts            # 初始化日记
│   │   ├── log.ts             # 日志事件追加
│   │   ├── task.ts            # 创建任务 + work-engine 桥接
│   │   ├── complete.ts        # 完成 / block / unblock
│   │   ├── today.ts           # 今日概览
│   │   ├── week-review.ts     # 周复盘
│   │   ├── link.ts            # 双链校验
│   │   └── sync.ts            # 同步 checkbox 到工作任务
│   ├── lib/
│   │   ├── diary.ts           # 核心日记操作（事件解析、appendEvent）
│   │   ├── path-utils.ts      # 路径工具（ISO 周数、日记路径计算）
│   │   ├── work-bridge.ts     # 工作任务桥接（createTaskViaEngine）
│   │   └── cli-utils.ts       # CLI 通用工具函数
│   └── llm/                   # LLM 提供者（agent / api）
├── docs/
│   └── plan.md                # 架构设计文档
├── package.json
└── tsconfig.json
```

### 核心模块说明

| 模块 | 职责 |
|------|------|
| `lib/diary.ts` | 解析日记 frontmatter、追加事件、管理事件时间线 |
| `lib/path-utils.ts` | ISO 周数计算、`20-Daily/YYYY/WXX/` 路径生成 |
| `lib/work-bridge.ts` | 调用 work-engine CLI 创建任务、导入 vault-utils 查找逻辑 |
| `lib/cli-utils.ts` | 通用 CLI 输出格式化 |
| `llm/` | LLM 提供者抽象层，支持 agent 和 API 两种模式 |

## 双向桥接

daily-engine 与 work-engine 构成双向桥接，打通时间维度与业务维度：

```
┌──────────────┐          ┌──────────────┐
│  daily-engine │          │  work-engine  │
│  (20-Daily/)  │          │   (Work/)     │
├──────────────┤          ├──────────────┤
│              │ ──task──▶│              │
│              │ ──sync──▶│              │
│              │◀──log────│              │
└──────────────┘          └──────────────┘
```

### daily → work

- **task 命令**：调用 work-engine CLI 在 `Work/` 中创建任务文件
- **sync 命令**：读取日记中 checkbox 状态，同步到对应工作任务

### work → daily

- **work-engine 的 status 命令**：状态变更时自动向当日日记写入日志事件

### 双链策略（Strategy A）

- daily-engine 在 Task frontmatter 中写入 `_at`（创建时间）和 `_log`（日志链接）
- 日记事件中使用 `[[wikilink]]` 引用任务
- Dataview 可通过 Task 的 `_at`/`_log` 字段进行 O(1) 查询

## 开发说明

### 环境要求

- Node.js >= 18
- TypeScript >= 5.3

### 常用命令

```bash
npm run build       # 编译 TypeScript → dist/
npm run dev         # 监听模式编译
npm run test        # 运行测试（vitest）
```

### 依赖

| 依赖 | 用途 |
|------|------|
| `commander` | CLI 框架 |
| `gray-matter` | YAML frontmatter 解析 |
| `@hermes/vault-utils` | Obsidian vault 通用工具（路径、查找等） |

### 开发流程

1. 修改 `src/` 下的 TypeScript 源码
2. `npm run build` 编译
3. 在 vault 目录下测试：`daily-engine <command>`
4. `npm run test` 确保测试通过

## 许可

MIT
