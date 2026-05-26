import { Command } from "commander";
import fs from "fs";
import matter from "gray-matter";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { readDiary, ensureDiary, formatEventLine } from "../lib/diary.js";
import { WORK_DIR, formatDate, getISOWeek, relativeToVault } from "../lib/path-utils.js";
import path from "path";

export function todayCommand(): Command {
  return new Command("today")
    .description("Show today's summary — diary events + active tasks")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const date = opts.date ? new Date(opts.date + "T00:00:00") : new Date();
      const dateStr = formatDate(date);
      const { weekYear, week } = getISOWeek(date);

      console.log(`\n📅 ${dateStr}  (W${week}, ${weekYear})`);
      console.log("═".repeat(50));

      // 1. Diary events
      const diary = readDiary(ctx.vault.root, date);
      if (diary) {
        section(`📄 Diary: ${diary.relPath}`);
        if (diary.events.length === 0) {
          console.log("  (no events yet)");
        } else {
          for (const evt of diary.events) {
            console.log(`  ${formatEventLine(evt)}`);
          }
        }
      } else {
        section("📄 Diary");
        console.log("  (not created yet — run `daily-engine init`)");
      }

      // 2. Active tasks from Work/
      section("🌿 Active Tasks (from Work/)");
      const workRoot = path.join(ctx.vault.root, WORK_DIR);
      if (!fs.existsSync(workRoot)) {
        console.log("  (no Work/ directory)");
        return;
      }

      let activeCount = 0;
      const projects = fs.readdirSync(workRoot).filter(d => {
        const full = path.join(workRoot, d);
        return fs.statSync(full).isDirectory();
      });

      for (const project of projects) {
        const projDir = path.join(workRoot, project);
        const files = fs.readdirSync(projDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");

        for (const file of files) {
          const filePath = path.join(projDir, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          try {
            const parsed = matter(raw);
            const status = parsed.data.status ?? "";
            if (status.includes("Active") || status.includes("Blocked")) {
              const icon = status.includes("Blocked") ? "🚧" : "🌿";
              const title = parsed.data.title ?? parsed.content.match(/^#\s+(.+)/m)?.[1] ?? file.replace(/\.md$/, "");
              const relPath = relativeToVault(ctx.vault.root, filePath);
              console.log(`  ${icon} [[${relPath.replace(/\.md$/, "")}|${project}: ${title}]]`);
              activeCount++;
            }
          } catch {
            // skip unparseable files
          }
        }
      }

      if (activeCount === 0) {
        console.log("  (no active tasks)");
      }

      console.log();
    });
}
