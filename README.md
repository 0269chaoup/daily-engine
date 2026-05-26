# daily-engine

Daily journal orchestration engine for Obsidian — event-sourced diary with Work/ dual-linking.

## Architecture

```
daily-engine (编排层)
  ├── 创建任务 → work-engine → 30-Projects/Work/{project}/Task.md
  ├── 写入链接 → Task.md frontmatter (created_log / completed_log)
  └── 追加事件 → 20-Daily/.../YYYY-MM-DD.md (日志 section)
```

**核心原则**：任务 SSOT 在 Work/，日记只记录事件流，daily-engine 负责双向链接。

## Installation

```bash
npm install
npm run build
npm link
```

## Commands

### `daily-engine init`
初始化今日日记（不存在则创建）。

```bash
daily-engine init
daily-engine init --date 2026-05-27
```

### `daily-engine task <project> <title>`
创建任务：调用 work-engine 创建 Task.md + 写入双链 + 日记事件。

```bash
daily-engine task MCP "实现 ingest --to-sources"
daily-engine task QtGeneralUI "重构菜单模块" --status "🌿 Active"
```

写入内容：
- Task.md frontmatter: `created_log`, `created_at`
- 日记: `- \`HH:MM\` 🆕 新增任务 [[Task|alias]] #task-created`

### `daily-engine log <message>`
追加日志事件到日记，可选链接到任务。

```bash
daily-engine log "完成 defuddle fallback 实现"
daily-engine log "修复搜索排序" -p MCP -t "MCP Server 架构"
```

### `daily-engine complete <project> <title>`
完成任务：更新状态为 🍂 Completed + 写入双链 + 日记事件。

```bash
daily-engine complete MCP "实现 ingest --to-sources"
daily-engine complete MCP "实现 ingest" --message "已合并到 main"
```

写入内容：
- Task.md frontmatter: `status: 🍂 Completed`, `completed_log`, `completed_at`
- 日记: `- \`HH:MM\` ✅ 任务完成 [[Task|alias]] #task-completed`

### `daily-engine block <project> <title>`
标记任务为阻塞。

```bash
daily-engine block MCP "实现 WebSocket" --reason "等待后端 API"
```

### `daily-engine unblock <project> <title>`
解除阻塞，恢复为 🌿 Active。

### `daily-engine today`
今日摘要：日记事件 + Work/ 活跃任务。

### `daily-engine week-review`
生成周复盘报表（扫描 Work/ 任务状态）。

```bash
daily-engine week-review
daily-engine week-review --date 2026-05-27 --force
```

### `daily-engine link`
校验 Work/ 与 Daily/ 之间的双向链接完整性。

```bash
daily-engine link
daily-engine link -p MCP
daily-engine link --fix  # 自动修复缺失的 created_log
```

## Dual Link Strategy (策略 A)

Task.md frontmatter 中的生命周期锚点字段：

```yaml
---
type: Task
status: 🍂 Completed
created_at: '2026-05-26'
created_log: '[[20-Daily/2026/05/第22周/2026-05-26]]'
completed_at: '2026-05-30'
completed_log: '[[20-Daily/2026/05/第22周/2026-05-30]]'
---
```

日记中的事件记录：

```markdown
## 日志
- `10:30` 🆕 新增任务 [[30-Projects/Work/MCP/实现ingest|MCP: 实现 ingest]] #task-created
- `18:30` ✅ 任务完成 [[30-Projects/Work/MCP/实现ingest|MCP: 实现 ingest]] #task-completed
```

## DataviewJS Query Examples

```dataviewjs
// 查找本周完成的任务
dv.pages('"30-Projects/Work"')
  .where(p => p.completed_at >= "2026-05-26")
  .sort(p => p.completed_at, 'desc')

// 查找所有活跃任务及其创建日记
dv.pages('"30-Projects/Work"')
  .where(p => p.status?.includes("Active"))
  .forEach(p => {
    dv.paragraph(`${p.file.link} — 创建于 ${p.created_log ?? "unknown"}`)
  })
```

## Dependencies

- `commander` — CLI framework
- `gray-matter` — YAML frontmatter parsing
- `work-engine` (optional) — Task file creation; falls back to direct creation if not installed
