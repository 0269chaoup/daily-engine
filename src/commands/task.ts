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

      // 1. Create task via work-engine (or directly if not available)
      section("① Creating task in Work/");
      const task = createTaskViaEngine(ctx.vault.root, project, title, {
        status: opts.status,
        group: opts.group.length > 0 ? opts.group : undefined,
      });
      row("Task", task.relPath, "📄");
      row("Status", task.status, "🏷️");

      // 2. Update task frontmatter with diary link
      section("② Linking task → diary");
      updateTaskDiaryLink(task.absPath, "created_log", date, ctx.vault.root);
      const diaryRelPath = relativeToVault(ctx.vault.root, getDiaryPath(ctx.vault.root, date));
      row("created_log", toWikilink(diaryRelPath), "🔗");

      // 3. Append event to diary
      section("③ Adding diary event");
      const diary = ensureDiary(ctx.vault.root, date);
      const diaryLink = toWikilink(task.relPath, task.alias);

      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: EVENT_ICONS.created,
        description: `新增任务`,
        links: [diaryLink],
        tags: ["#task-created"],
      });

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
