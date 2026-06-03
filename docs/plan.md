---
type: Plan
status: active
created: 2026-05-27T00:00:00.000Z
updated: '2026-05-27'
version: 4
domain: daily-engine
---

# daily-engine-编排层架构

## 背景

时间维度与业务维度存在数据孤岛

## 目标

消除数据孤岛，实现任务 SSOT

## 方案设计

### 核心原则
- 日记 SSOT 在 20-Daily/
- 任务 SSOT 在 Work/（通过 work-engine 管理）
- daily-engine 作为编排层，负责时间线事件记录和跨引擎调度
- Strategy A：Task frontmatter 使用生命周期字段

### CLI 命令
| 命令 | 功能 |
|------|------|
| init | 初始化今日日记 |
| task | 创建任务 + 双链 |
| log | 追加日志事件 |
| complete | 完成任务 + 双链 |
| block/unblock | 阻塞/解除阻塞 |
| today | 今日摘要 |
| week-review | 周复盘报表 |
| link | 双链校验 |

### 双链系统（Strategy A）
- daily-engine 负责写入 Task frontmatter 的 _at/_log 字段
- daily-engine 负责写入日记事件（带 wikilink）
- Dataview 可通过 Task 字段进行 O(1) 查询
## 实施状态

- [x] 核心 CLI 框架
- [x] 初始化今日日记（init）
- [x] 创建任务 + 双链（task）
- [x] 追加日志事件（log）
- [x] 完成任务 + 双链（complete）
- [x] 阻塞/解除阻塞（block/unblock）
- [x] 今日摘要（today）
- [x] 周复盘报表（week-review）
- [x] 双链校验（link --fix）
- [x] work-engine 桥接
- [x] 旧日记任务迁移
## 变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-27 | v1 | 初稿 |
| 2026-05-27 | v4 | 补充完整架构设计（Strategy A、双链系统） |
