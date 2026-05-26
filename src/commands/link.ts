import { Command } from "commander";
import fs from "fs";
import matter from "gray-matter";
import path from "path";
import { buildContext, row, section } from "../lib/cli-utils.js";
import {
  WORK_DIR,
  DAILY_DIR,
  relativeToVault,
  toWikilink,
} from "../lib/path-utils.js";

interface LinkIssue {
  type: "missing_created_log" | "missing_diary_event" | "orphan_diary_link" | "dead_link";
  taskFile?: string;
  diaryFile?: string;
  detail: string;
}

export function linkCommand(): Command {
  return new Command("link")
    .description("Validate dual links between Work/ tasks and Daily/ diary events")
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--fix", "Attempt to fix missing created_log fields", false)
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const issues: LinkIssue[] = [];
      let checked = 0;

      console.log(`\n🔗 Checking dual links...\n`);

      const workRoot = path.join(ctx.vault.root, WORK_DIR);
      if (!fs.existsSync(workRoot)) {
        console.log("  (no Work/ directory)");
        return;
      }

      const projects = fs.readdirSync(workRoot).filter(d => {
        const full = path.join(workRoot, d);
        return fs.statSync(full).isDirectory();
      });

      const filteredProjects = opts.project ? projects.filter(p => p === opts.project) : projects;

      for (const project of filteredProjects) {
        const projDir = path.join(workRoot, project);
        const files = fs.readdirSync(projDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");

        for (const file of files) {
          const filePath = path.join(projDir, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          try {
            const parsed = matter(raw);
            const relPath = relativeToVault(ctx.vault.root, filePath);
            checked++;

            // Check: does task have created_log?
            if (!parsed.data.created_log) {
              issues.push({
                type: "missing_created_log",
                taskFile: relPath,
                detail: `No created_log field`,
              });

              // Try to fix: infer from created date
              if (opts.fix && parsed.data.created) {
                const createdDate = new Date(parsed.data.created.replace(/'/g, ""));
                if (!isNaN(createdDate.getTime())) {
                  const diaryPath = getDiaryPathForDate(ctx.vault.root, createdDate);
                  if (diaryPath && fs.existsSync(diaryPath)) {
                    parsed.data.created_log = toWikilink(relativeToVault(ctx.vault.root, diaryPath));
                    parsed.data.created_at = parsed.data.created;
                    fs.writeFileSync(filePath, matter.stringify(parsed.content, parsed.data), "utf-8");
                    console.log(`  🔧 Fixed: ${relPath} → created_log set`);
                  }
                }
              }
            }

            // Check: if created_log exists, does the diary file exist?
            if (parsed.data.created_log) {
              const diaryLinkMatch = parsed.data.created_log.match(/\[\[([^\]|]+)/);
              if (diaryLinkMatch) {
                const diaryPath = path.join(ctx.vault.root, diaryLinkMatch[1] + ".md");
                if (!fs.existsSync(diaryPath)) {
                  issues.push({
                    type: "dead_link",
                    taskFile: relPath,
                    detail: `created_log points to missing: ${diaryLinkMatch[1]}`,
                  });
                }
              }
            }

            // Same for completed_log
            if (parsed.data.completed_log) {
              const diaryLinkMatch = parsed.data.completed_log.match(/\[\[([^\]|]+)/);
              if (diaryLinkMatch) {
                const diaryPath = path.join(ctx.vault.root, diaryLinkMatch[1] + ".md");
                if (!fs.existsSync(diaryPath)) {
                  issues.push({
                    type: "dead_link",
                    taskFile: relPath,
                    detail: `completed_log points to missing: ${diaryLinkMatch[1]}`,
                  });
                }
              }
            }
          } catch { /* skip unparseable */ }
        }
      }

      // Report
      if (issues.length === 0) {
        console.log(`✅ All ${checked} task files have valid dual links.\n`);
        return;
      }

      const byType = new Map<string, LinkIssue[]>();
      for (const issue of issues) {
        const existing = byType.get(issue.type) ?? [];
        existing.push(issue);
        byType.set(issue.type, existing);
      }

      for (const [type, typeIssues] of byType) {
        const icon = type === "dead_link" ? "❌" : "⚠️";
        section(`${icon} ${type} (${typeIssues.length})`);
        for (const issue of typeIssues) {
          console.log(`  ${issue.taskFile ?? issue.diaryFile}: ${issue.detail}`);
        }
      }

      console.log(`\n${"═".repeat(50)}`);
      console.log(`Checked: ${checked} | Issues: ${issues.length}`);
      if (!opts.fix && issues.some(i => i.type === "missing_created_log")) {
        console.log(`\n💡 Run with --fix to auto-fill missing created_log fields from task created date.`);
      }
      console.log();
    });
}

function getDiaryPathForDate(vaultRoot: string, date: Date): string | null {
  const { getISOWeek } = require("../lib/path-utils.js");
  const { weekYear, week } = getISOWeek(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const weekStr = String(week).padStart(2, "0");
  const dateStr = `${year}-${month}-${String(date.getDate()).padStart(2, "0")}`;

  return path.join(
    vaultRoot,
    DAILY_DIR,
    String(year),
    month,
    `第${weekStr}周`,
    `${dateStr}.md`
  );
}
