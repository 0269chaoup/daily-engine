/**
 * @file task 命令 — 创建新任务
 *
 * 功能：创建一个新的工作任务，包含完整的双向链接流程：
 *   1. 在 Work/<project>/ 目录下创建任务 Markdown 文件
 *   2. 在任务文件的 frontmatter 中添加 created_log 链接指向日记
 *   3. 在日记的"日志"section 中追加创建事件，包含指向任务的 wikilink
 *
 * 这实现了"双向链接"设计：任务知道它在哪天被创建（created_log → 日记），
 * 日记也知道当天创建了哪些任务（事件中的 wikilink → 任务）。
 *
 * 依赖：
 *   - lib/diary.ts       → ensureDiary, appendEvent, updateTaskDiaryLink, EVENT_ICONS (日记操作)
 *   - lib/work-bridge.ts → createTaskViaEngine, findTaskFile, readTaskInfo (任务创建)
 *   - lib/path-utils.ts  → 路径和日期格式化工具
 *
 * 用法示例：
 *   daily-engine task MyProject "实现用户登录功能"
 *   daily-engine task MyProject "重构数据库层" --status "🌿 Active"
 *   daily-engine task MyProject "API文档" --group backend --group docs
 */

import { Command } from "commander";
import { buildContext, row, section } from "../lib/cli-utils.js";
import {
  ensureDiary,
  appendEvent,
  updateTaskDiaryLink,
  EVENT_ICONS,
  formatEventLine,
} from "../lib/diary.js";
import {
  createTaskViaEngine,
  findTaskFile,
  readTaskInfo,
} from "../lib/work-bridge.js";
import {
  formatDate,
  formatTime,
  getDiaryPath,
  relativeToVault,
  toWikilink,
} from "../lib/path-utils.js";

/**
 * 创建 task 子命令
 *
 * @returns {Command} commander Command 实例
 *
 * 参数：
 *   <project>          项目名称，对应 30-Projects/Work/ 下的子目录
 *   <title>            任务标题
 *   --date <date>      日记日期，默认今日
 *   --status <status>  初始状态，默认 "🌱 Planned"
 *   --group <name>     任务分组，可重复使用
 *
 * 处理流程：
 *   1. 调用 createTaskViaEngine 创建任务文件（优先使用 work-engine CLI，不可用则直接创建）
 *   2. 更新任务 frontmatter 中的 created_log 字段，链接到当天日记
 *   3. 在日记中追加一条"新增任务"事件
 */
export function taskCommand(): Command {
  return new Command("task")
    .description("Create a new task: creates Work/ file + diary event + dual links")
    .argument("<project>", "Project name (directory under 30-Projects/Work)")
    .argument("<title>", "Task title")
    .option("--date <date>", "Date for diary entry (YYYY-MM-DD), default: today")
    .option("--status <status>", "Initial status", "🌱 Planned")
    .option("--group <name>", "Task group (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
    .action((project, title, opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const now = new Date();
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;

      // 步骤 1：在 Work/ 目录下创建任务文件
      section("① Creating task in Work/");
      const task = createTaskViaEngine(ctx.vault.root, project, title, {
        status: opts.status,
        group: opts.group.length > 0 ? opts.group : undefined,
      });
      row("Task", task.relPath, "📄");
      row("Status", task.status, "🏷️");

      // 步骤 2：在任务 frontmatter 中添加 created_log 链接，指向当天日记
      section("② Linking task → diary");
      updateTaskDiaryLink(task.absPath, "created_log", date, ctx.vault.root);
      const diaryRelPath = relativeToVault(ctx.vault.root, getDiaryPath(ctx.vault.root, date));
      row("created_log", toWikilink(diaryRelPath), "🔗");

      // 步骤 3：在日记中追加创建事件（反向链接）
      section("③ Adding diary event");
      const diary = ensureDiary(ctx.vault.root, date);
      // 创建指向任务的 wikilink，使用 "项目: 标题" 作为别名
      const diaryLink = toWikilink(task.relPath, task.alias);

      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: EVENT_ICONS.created,
        description: `新增任务`,
        links: [diaryLink],
        tags: ["#task-created"],
      });

      // 输出结果摘要
      const relDiary = relativeToVault(ctx.vault.root, diary.absPath);
      row("Diary", relDiary, "📅");
      row("Event", formatEventLine({
        time: formatTime(now),
        icon: EVENT_ICONS.created,
        description: "新增任务",
        links: [diaryLink],
        tags: ["#task-created"],
      }), "📝");

      console.log(`\n✅ Task created with dual links.\n`);
    });
}
