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

      // Find task if specified
      const links: string[] = [];
      if (opts.task) {
        const task = opts.project
          ? (() => {
              const absPath = findTaskFile(ctx.vault.root, opts.project, opts.task);
              return absPath ? readTaskInfo(ctx.vault.root, absPath) : null;
            })()
          : findTaskFileGlobal(ctx.vault.root, opts.task);

        if (task) {
          links.push(toWikilink(task.relPath, task.alias));
        } else {
          console.warn(`⚠️  Task not found: ${opts.task}`);
        }
      }

      // Append event
      const diary = ensureDiary(ctx.vault.root, date);
      const tags = ["#log", ...opts.tag];

      appendEvent(ctx.vault.root, date, {
        time: formatTime(now),
        icon: opts.icon,
        description: message,
        links,
        tags,
      });

      const relDiary = relativeToVault(ctx.vault.root, diary.absPath);
      console.log(`\n📝 Log entry added to ${relDiary}`);
      console.log(`   ${formatEventLine({ time: formatTime(now), icon: opts.icon, description: message, links, tags })}\n`);
    });
}
