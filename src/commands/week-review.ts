import { Command } from "commander";
import fs from "fs";
import matter from "gray-matter";
import path from "path";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { readDiary, ensureDiary } from "../lib/diary.js";
import {
  WORK_DIR,
  DAILY_DIR,
  formatDate,
  getISOWeek,
  getWeekReviewPath,
  relativeToVault,
  toWikilink,
  ensureDir,
} from "../lib/path-utils.js";

export function weekReviewCommand(): Command {
  return new Command("week-review")
    .description("Generate or update this week's review report")
    .option("--date <date>", "Any date in the target week (YYYY-MM-DD), default: today")
    .option("--force", "Overwrite existing week review", false)
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const date = opts.date ? new Date(opts.date + "T00:00:00") : new Date();
      const { weekYear, week } = getISOWeek(date);
      const weekStr = String(week).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");

      const reviewPath = getWeekReviewPath(ctx.vault.root, date);
      const relReviewPath = relativeToVault(ctx.vault.root, reviewPath);

      // Check if already exists
      if (fs.existsSync(reviewPath) && !opts.force) {
        console.log(`\n⚠️  Week review already exists: ${relReviewPath}`);
        console.log(`   Use --force to overwrite.\n`);
        return;
      }

      // Gather data: scan Work/ for tasks
      const workRoot = path.join(ctx.vault.root, WORK_DIR);
      const tasks = { active: [] as any[], completed: [] as any[], blocked: [] as any[], planned: [] as any[] };

      if (fs.existsSync(workRoot)) {
        const projects = fs.readdirSync(workRoot).filter(d =>
          fs.statSync(path.join(workRoot, d)).isDirectory()
        );

        for (const project of projects) {
          const projDir = path.join(workRoot, project);
          const files = fs.readdirSync(projDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");

          for (const file of files) {
            const filePath = path.join(projDir, file);
            try {
              const raw = fs.readFileSync(filePath, "utf-8");
              const parsed = matter(raw);
              const status = parsed.data.status ?? "";
              const title = parsed.data.title ?? parsed.content.match(/^#\s+(.+)/m)?.[1] ?? file.replace(/\.md$/, "");
              const relPath = relativeToVault(ctx.vault.root, filePath);
              const created = parsed.data.created_at ?? parsed.data.created ?? "";
              const completed = parsed.data.completed_at ?? "";

              // Check if this task was active this week
              const taskInfo = { project, title, relPath, status, created, completed };

              if (status.includes("Active")) tasks.active.push(taskInfo);
              else if (status.includes("Completed") && isInWeek(completed, weekYear, week)) tasks.completed.push(taskInfo);
              else if (status.includes("Blocked")) tasks.blocked.push(taskInfo);
              else if (status.includes("Planned") && isInWeek(created, weekYear, week)) tasks.planned.push(taskInfo);
            } catch { /* skip */ }
          }
        }
      }

      // Gather diary events for this week
      const weekDays = getWeekDays(date);
      const allEvents: string[] = [];
      for (const day of weekDays) {
        const diary = readDiary(ctx.vault.root, day);
        if (diary && diary.events.length > 0) {
          allEvents.push(`### ${formatDate(day)}`);
          for (const evt of diary.events) {
            allEvents.push(formatEventLine(evt));
          }
          allEvents.push("");
        }
      }

      // Build week review content
      const totalTasks = tasks.active.length + tasks.completed.length + tasks.blocked.length + tasks.planned.length;
      const completionPct = totalTasks > 0 ? Math.round((tasks.completed.length / totalTasks) * 100) : 0;

      const content = `---
tags: weekly
week: ${weekYear}-W${weekStr}
---

# ${weekYear}年-第${week}周 复盘

[[${date.getFullYear()}_年视图]] / [[${date.getFullYear()}-${month}_月视图]]

---

## 📊 本周统计

- **活跃任务**: ${tasks.active.length}
- **完成任务**: ${tasks.completed.length}
- **阻塞任务**: ${tasks.blocked.length}
- **新增任务**: ${tasks.planned.length}
- **完成率**: ${completionPct}%

## 🌿 Active (${tasks.active.length})

${tasks.active.map(t => `- [[${t.relPath.replace(/\.md$/, "")}|${t.project}: ${t.title}]]`).join("\n") || "- (none)"}

## ✅ Completed This Week (${tasks.completed.length})

${tasks.completed.map(t => `- [[${t.relPath.replace(/\.md$/, "")}|${t.project}: ${t.title}]] ${t.completed}`).join("\n") || "- (none)"}

## 🚧 Blocked (${tasks.blocked.length})

${tasks.blocked.map(t => `- [[${t.relPath.replace(/\.md$/, "")}|${t.project}: ${t.title}]]`).join("\n") || "- (none)"}

## 🆕 New This Week (${tasks.planned.length})

${tasks.planned.map(t => `- [[${t.relPath.replace(/\.md$/, "")}|${t.project}: ${t.title}]] ${t.created}`).join("\n") || "- (none)"}

## 📅 本周事件流

${allEvents.join("\n") || "(no events recorded)"}

## 💪 本周成就

-

## 📝 本周总结

-

## 🔮 下周计划

-
`;

      ensureDir(reviewPath);
      fs.writeFileSync(reviewPath, content, "utf-8");

      console.log(`\n📋 Week review generated: ${relReviewPath}`);
      row("Week", `${weekYear}-W${weekStr}`, "📅");
      row("Active", String(tasks.active.length), "🌿");
      row("Completed", String(tasks.completed.length), "✅");
      row("Blocked", String(tasks.blocked.length), "🚧");
      row("Completion", `${completionPct}%`, "📊");
      console.log();
    });
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Check if a date string falls within a given ISO week */
function isInWeek(dateStr: string, weekYear: number, week: number): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr.replace(/'/g, ""));
    const w = getISOWeek(d);
    return w.weekYear === weekYear && w.week === week;
  } catch {
    return false;
  }
}

/** Get all 7 days (Mon-Sun) of the ISO week containing the given date */
function getWeekDays(date: Date): Date[] {
  const d = new Date(date);
  // Get Monday of this week (ISO: Monday = 1)
  const day = d.getDay() || 7; // Sunday = 7
  d.setDate(d.getDate() - day + 1); // Back to Monday

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** Format event line (same as diary.ts but accessible here) */
function formatEventLine(evt: { time: string; icon: string; description: string; links: string[]; tags: string[] }): string {
  const linksStr = evt.links.length > 0 ? " " + evt.links.join(" ") : "";
  const tagsStr = evt.tags.length > 0 ? " " + evt.tags.join(" ") : "";
  return `- \`${evt.time}\` ${evt.icon} ${evt.description}${linksStr}${tagsStr}`;
}
