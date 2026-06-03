/**
 * @file complete 命令 — 任务完成/阻塞/解除阻塞
 *
 * 功能：提供三个任务状态管理命令：
 *   1. complete  — 标记任务为"完成"：更新状态 + 记录日记事件 + 建立双向链接
 *   2. block     — 标记任务为"阻塞"：更新状态 + 可选阻塞原因 + 日记事件
 *   3. unblock   — 解除任务阻塞：恢复活跃状态 + 清除阻塞字段 + 日记事件
 *
 * 每个命令都会执行双向链接操作：
 *   - 更新任务文件 frontmatter 中的状态和生命周期链接
 *   - 在对应日期的日记中追加事件记录
 *
 * 依赖：
 *   - lib/cli-utils.ts  → buildContext, row, section (CLI 输出)
 *   - lib/diary.ts      → ensureDiary, appendEvent, updateTaskDiaryLink, removeTaskBlockedFields (日记操作)
 *   - lib/work-bridge.ts → findTaskFile, findTaskFileGlobal, readTaskInfo (任务查找)
 *   - lib/path-utils.ts → 路径和日期工具
 */

import { Command } from "commander";
import fs from "fs";
import matter from "gray-matter";
import { buildContext, row, section } from "../lib/cli-utils.js";
import {
  ensureDiary,
  appendEvent,
  updateTaskDiaryLink,
  removeTaskBlockedFields,
  EVENT_ICONS,
  formatEventLine,
} from "../lib/diary.js";
import {
  findTaskFile,
  findTaskFileGlobal,
  readTaskInfo,
} from "../lib/work-bridge.js";
import {
  formatDate,
  formatTime,
  relativeToVault,
  toWikilink,
  getDiaryPath,
} from "../lib/path-utils.js";

/**
 * 创建 complete 子命令 — 标记任务完成
 *
 * @returns {Command} commander Command 实例
 *
 * 参数：
 *   <project>           项目名称
 *   <title>             任务标题
 *   --date <date>       目标日期，默认今日
 *   --message <msg>     完成消息，默认 "任务完成"
 *
 * 处理流程：
 *   1. 在 Work/ 中查找任务文件
 *   2. 更新任务 frontmatter 中的 status 为 "🍂 Completed"
 *   3. 在任务 frontmatter 中添加 completed_log 链接到日记
 *   4. 在日记中追加一条完成事件
 */
export function completeCommand(): Command {
  return new Command("complete")
    .description("Mark a task as Completed: update Work/ status + diary event + dual links")
    .argument("<project>", "Project name")
    .argument("<title>", "Task title")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .option("--message <msg>", "Completion message", "任务完成")
    .action((project, title, opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const now = new Date();
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;

      // 步骤 1：查找任务文件
      section("① Finding task");
      const absPath = findTaskFile(ctx.vault.root, project, title);
      if (!absPath) {
        console.error(`\n❌ Task not found: ${project}/${title}\n`);
        process.exit(1);
      }
      const task = readTaskInfo(ctx.vault.root, absPath)!;
      row("Task", task.relPath, "📄");
      row("Status", `${task.status} → 🍂 Completed`, "🏷️");

      // 步骤 2：更新任务状态为完成
      section("② Updating task status");
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = matter(raw);
      parsed.data.status = "🍂 Completed";
      const newContent = matter.stringify(parsed.content, parsed.data);
      fs.writeFileSync(absPath, newContent, "utf-8");
      row("status", "🍂 Completed", "✅");

      // 步骤 3：在任务 frontmatter 中添加 completed_log 链接（任务 → 日记）
      updateTaskDiaryLink(absPath, "completed_log", date, ctx.vault.root);
      const completedDiaryRel = relativeToVault(ctx.vault.root, getDiaryPath(ctx.vault.root, date));
      row("completed_log", toWikilink(completedDiaryRel), "🔗");

      // 步骤 4：在日记中追加完成事件（日记 → 任务）
      section("③ Adding diary event");
      const diary = ensureDiary(ctx.vault.root, date);
      const diaryLink = toWikilink(task.relPath, task.alias);

      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: EVENT_ICONS.completed,
        description: opts.message,
        links: [diaryLink],
        tags: ["#task-completed"],
      });

      const relDiary = relativeToVault(ctx.vault.root, diary.absPath);
      row("Diary", relDiary, "📅");

      console.log(`\n✅ Task completed with dual links.\n`);
    });
}

/**
 * 创建 block 子命令 — 标记任务阻塞
 *
 * @returns {Command} commander Command 实例
 *
 * 参数：
 *   <project>         项目名称
 *   <title>           任务标题
 *   --reason <msg>    阻塞原因
 *   --date <date>     目标日期，默认今日
 *
 * 处理流程：
 *   1. 查找任务文件
 *   2. 更新状态为 "🚧 Blocked"，记录阻塞原因到 blocked_by 字段
 *   3. 在任务 frontmatter 中添加 blocked_log 链接
 *   4. 在日记中追加阻塞事件
 */
export function blockCommand(): Command {
  return new Command("block")
    .description("Mark a task as Blocked")
    .argument("<project>", "Project name")
    .argument("<title>", "Task title")
    .option("--reason <msg>", "Blocking reason")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .action((project, title, opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const now = new Date();
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;

      const absPath = findTaskFile(ctx.vault.root, project, title);
      if (!absPath) {
        console.error(`\n❌ Task not found: ${project}/${title}\n`);
        process.exit(1);
      }
      const task = readTaskInfo(ctx.vault.root, absPath)!;

      // 更新任务状态和阻塞原因
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = matter(raw);
      parsed.data.status = "🚧 Blocked";
      if (opts.reason) parsed.data.blocked_by = opts.reason;
      fs.writeFileSync(absPath, matter.stringify(parsed.content, parsed.data), "utf-8");

      // 在任务 frontmatter 中添加 blocked_log 链接
      updateTaskDiaryLink(absPath, "blocked_log", date, ctx.vault.root);

      // 在日记中追加阻塞事件
      const diary = ensureDiary(ctx.vault.root, date);
      const diaryLink = toWikilink(task.relPath, task.alias);
      const desc = opts.reason ? `阻塞: ${opts.reason}` : "任务阻塞";

      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: EVENT_ICONS.blocked,
        description: desc,
        links: [diaryLink],
        tags: ["#task-blocked"],
      });

      console.log(`\n🚧 Task blocked: ${task.relPath}\n`);
    });
}

/**
 * 创建 unblock 子命令 — 解除任务阻塞
 *
 * @returns {Command} commander Command 实例
 *
 * 参数：
 *   <project>       项目名称
 *   <title>         任务标题
 *   --date <date>   目标日期，默认今日
 *
 * 处理流程：
 *   1. 查找任务文件
 *   2. 恢复状态为 "🌿 Active"，删除 blocked_by 字段
 *   3. 移除任务 frontmatter 中的 blocked_at 和 blocked_log 字段
 *   4. 在日记中追加解除阻塞事件
 */
export function unblockCommand(): Command {
  return new Command("unblock")
    .description("Remove Blocked status from a task")
    .argument("<project>", "Project name")
    .argument("<title>", "Task title")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .action((project, title, opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const now = new Date();
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;

      const absPath = findTaskFile(ctx.vault.root, project, title);
      if (!absPath) {
        console.error(`\n❌ Task not found: ${project}/${title}\n`);
        process.exit(1);
      }
      const task = readTaskInfo(ctx.vault.root, absPath)!;

      // 恢复活跃状态，删除阻塞原因
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = matter(raw);
      parsed.data.status = "🌿 Active";
      delete parsed.data.blocked_by;
      fs.writeFileSync(absPath, matter.stringify(parsed.content, parsed.data), "utf-8");

      // 移除阻塞相关字段
      removeTaskBlockedFields(absPath);

      // 在日记中追加解除阻塞事件
      const diary = ensureDiary(ctx.vault.root, date);
      const diaryLink = toWikilink(task.relPath, task.alias);

      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: EVENT_ICONS.unblocked,
        description: "阻塞解除",
        links: [diaryLink],
        tags: ["#task-unblocked"],
      });

      console.log(`\n🔓 Task unblocked: ${task.relPath}\n`);
    });
}
