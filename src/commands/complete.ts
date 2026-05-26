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

      // 1. Find the task
      section("① Finding task");
      const absPath = findTaskFile(ctx.vault.root, project, title);
      if (!absPath) {
        console.error(`\n❌ Task not found: ${project}/${title}\n`);
        process.exit(1);
      }
      const task = readTaskInfo(ctx.vault.root, absPath)!;
      row("Task", task.relPath, "📄");
      row("Status", `${task.status} → 🍂 Completed`, "🏷️");

      // 2. Update task status in frontmatter
      section("② Updating task status");
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = matter(raw);
      parsed.data.status = "🍂 Completed";
      const newContent = matter.stringify(parsed.content, parsed.data);
      fs.writeFileSync(absPath, newContent, "utf-8");
      row("status", "🍂 Completed", "✅");

      // 3. Add completed_log link
      updateTaskDiaryLink(absPath, "completed_log", date, ctx.vault.root);
      const completedDiaryRel = relativeToVault(ctx.vault.root, getDiaryPath(ctx.vault.root, date));
      row("completed_log", toWikilink(completedDiaryRel), "🔗");

      // 4. Append event to diary
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

      // Update status
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = matter(raw);
      parsed.data.status = "🚧 Blocked";
      if (opts.reason) parsed.data.blocked_by = opts.reason;
      fs.writeFileSync(absPath, matter.stringify(parsed.content, parsed.data), "utf-8");

      // Add blocked_log link
      updateTaskDiaryLink(absPath, "blocked_log", date, ctx.vault.root);

      // Diary event
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

      // Update status
      const raw = fs.readFileSync(absPath, "utf-8");
      const parsed = matter(raw);
      parsed.data.status = "🌿 Active";
      delete parsed.data.blocked_by;
      fs.writeFileSync(absPath, matter.stringify(parsed.content, parsed.data), "utf-8");

      // Remove blocked fields
      removeTaskBlockedFields(absPath);

      // Diary event
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
