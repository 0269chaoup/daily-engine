/**
 * @file log 命令 — 日志记录
 *
 * 功能：向指定日期的日记追加一条日志事件。
 * 可选地将日志关联到某个任务（通过 wikilink）。
 *
 * 事件格式：- `HH:MM` 📝 日志内容 [[任务链接]] #log
 *
 * 依赖：
 *   - lib/cli-utils.ts  → buildContext, row, section (CLI 上下文和输出格式化)
 *   - lib/diary.ts      → ensureDiary, appendEvent, EVENT_ICONS, formatEventLine (日记读写)
 *   - lib/work-bridge.ts → findTaskFile, findTaskFileGlobal, readTaskInfo (任务查找)
 *   - lib/path-utils.ts → formatDate, formatTime, relativeToVault, toWikilink (路径和日期工具)
 *
 * 用法示例：
 *   daily-engine log "完成了用户认证模块的开发"
 *   daily-engine log "修复登录bug" -p MyProject -t "用户认证"
 *   daily-engine log "会议记录" --date 2024-01-15 --icon 💡 --tag #meeting
 */

import { Command } from "commander";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { ensureDiary, appendEvent, EVENT_ICONS, formatEventLine } from "../lib/diary.js";
import { findTaskFile, findTaskFileGlobal, readTaskInfo } from "../lib/work-bridge.js";
import {
  formatDate,
  formatTime,
  relativeToVault,
  toWikilink,
} from "../lib/path-utils.js";

/**
 * 创建 log 子命令
 *
 * @returns {Command} commander Command 实例
 *
 * 参数：
 *   <message>              日志消息内容（必填）
 *   -p, --project <name>   项目名称（用于关联任务）
 *   -t, --task <title>     任务标题（用于关联任务）
 *   --date <date>          目标日期，默认今日
 *   --icon <icon>          事件图标，默认 📝
 *   --tag <tag>            额外标签，可重复使用
 *
 * 处理流程：
 *   1. 如果指定了 --task，查找对应任务并生成 wikilink
 *   2. 确保日记文件存在
 *   3. 向日记的"日志"section 追加事件
 *   4. 输出添加结果
 */
export function logCommand(): Command {
  return new Command("log")
    .description("Append a log entry to today's diary, optionally linked to a task")
    .argument("<message>", "Log message")
    .option("-p, --project <name>", "Project name (for linking to task)")
    .option("-t, --task <title>", "Task title (for linking)")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .option("--icon <icon>", "Event icon", "📝")
    .option("--tag <tag>", "Additional tag (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action((message, opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const now = new Date();
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;

      // 如果指定了任务名称，尝试查找并关联
      const links: string[] = [];
      if (opts.task) {
        // 如果同时指定了项目名，精确查找；否则全局搜索
        const task = opts.project
          ? (() => {
              const absPath = findTaskFile(ctx.vault.root, opts.project, opts.task);
              return absPath ? readTaskInfo(ctx.vault.root, absPath) : null;
            })()
          : findTaskFileGlobal(ctx.vault.root, opts.task);

        if (task) {
          // 生成任务的 wikilink（带别名显示 "项目: 标题"）
          links.push(toWikilink(task.relPath, task.alias));
        } else {
          console.warn(`⚠️  Task not found: ${opts.task}`);
        }
      }

      // 确保日记文件存在，获取日记信息
      const diary = ensureDiary(ctx.vault.root, date);
      // 构建标签列表：默认包含 #log，加上用户自定义标签
      const tags = ["#log", ...opts.tag];

      // 向日记追加事件
      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: opts.icon,
        description: message,
        links,
        tags,
      });

      // 输出添加结果
      const relDiary = relativeToVault(ctx.vault.root, diary.absPath);
      console.log(`\n📝 Log entry added to ${relDiary}`);
      console.log(`   ${formatEventLine({ time: formatTime(now), icon: opts.icon, description: message, links, tags })}\n`);
    });
}
