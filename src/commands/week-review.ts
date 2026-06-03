/**
 * @file week-review 命令 — 周复盘报告生成
 *
 * 功能：生成或更新指定周的复盘报告，包含：
 *   - 本周统计数据（活跃/完成/阻塞/新增任务数量和完成率）
 *   - 按状态分类的任务列表（带 wikilink）
 *   - 本周所有日记事件流
 *   - 占位章节：本周成就、本周总结、下周计划
 *
 * 报告生成路径：20-Daily/YYYY/MM/第NN周/YYYY-WNN_周复盘.md
 *
 * 依赖：
 *   - commander        → CLI 命令框架
 *   - fs/path          → 文件系统操作
 *   - gray-matter      → YAML frontmatter 解析
 *   - lib/diary.ts     → readDiary (读取每日日记)
 *   - lib/path-utils.ts → 路径生成、日期格式化等工具
 *
 * 用法示例：
 *   daily-engine week-review                    # 生成本周复盘
 *   daily-engine week-review --date 2024-01-15  # 生成指定日期所在周的复盘
 *   daily-engine week-review --force            # 强制覆盖已有的复盘
 */

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

/**
 * 创建 week-review 子命令
 *
 * @returns {Command} commander Command 实例
 *
 * 处理流程：
 *   1. 检查复盘文件是否已存在（除非 --force）
 *   2. 扫描 Work/ 目录收集任务状态数据
 *   3. 读取本周每天的日记事件
 *   4. 生成 Markdown 格式的复盘报告
 *   5. 写入文件并输出统计摘要
 */
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

      // 检查复盘文件是否已存在
      if (fs.existsSync(reviewPath) && !opts.force) {
        console.log(`\n⚠️  Week review already exists: ${relReviewPath}`);
        console.log(`   Use --force to overwrite.\n`);
        return;
      }

      // === 收集任务数据 ===
      const workRoot = path.join(ctx.vault.root, WORK_DIR);
      /** 按状态分类的任务集合 */
      const tasks = { active: [] as any[], completed: [] as any[], blocked: [] as any[], planned: [] as any[] };

      if (fs.existsSync(workRoot)) {
        // 获取所有项目目录
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
              // 提取标题：优先 frontmatter title，其次内容中的一级标题，最后用文件名
              const title = parsed.data.title ?? parsed.content.match(/^#\s+(.+)/m)?.[1] ?? file.replace(/\.md$/, "");
              const relPath = relativeToVault(ctx.vault.root, filePath);
              const created = parsed.data.created_at ?? parsed.data.created ?? "";
              const completed = parsed.data.completed_at ?? "";

              const taskInfo = { project, title, relPath, status, created, completed };

              // 按状态分类：活跃的始终计入，完成/新增只计入本周内的
              if (status.includes("Active")) tasks.active.push(taskInfo);
              else if (status.includes("Completed") && isInWeek(completed, weekYear, week)) tasks.completed.push(taskInfo);
              else if (status.includes("Blocked")) tasks.blocked.push(taskInfo);
              else if (status.includes("Planned") && isInWeek(created, weekYear, week)) tasks.planned.push(taskInfo);
            } catch { /* 跳过无法解析的文件 */ }
          }
        }
      }

      // === 收集本周日记事件 ===
      const weekDays = getWeekDays(date);
      /** 所有日记事件的 Markdown 行 */
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

      // === 生成复盘报告 ===
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

      // 写入复盘文件
      ensureDir(reviewPath);
      fs.writeFileSync(reviewPath, content, "utf-8");

      // 输出统计摘要
      console.log(`\n📋 Week review generated: ${relReviewPath}`);
      row("Week", `${weekYear}-W${weekStr}`, "📅");
      row("Active", String(tasks.active.length), "🌿");
      row("Completed", String(tasks.completed.length), "✅");
      row("Blocked", String(tasks.blocked.length), "🚧");
      row("Completion", `${completionPct}%`, "📊");
      console.log();
    });
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 判断一个日期字符串是否在指定的 ISO 周内
 *
 * @param dateStr   日期字符串（支持多种格式，如 "2024-01-15" 或 Obsidian 的 "'2024-01-15'"）
 * @param weekYear  ISO 周年份
 * @param week      ISO 周数
 * @returns {boolean} 如果日期在指定周内返回 true
 */
function isInWeek(dateStr: string, weekYear: number, week: number): boolean {
  if (!dateStr) return false;
  try {
    // 去除 Obsidian YAML 中可能出现的单引号
    const d = new Date(dateStr.replace(/'/g, ""));
    const w = getISOWeek(d);
    return w.weekYear === weekYear && w.week === week;
  } catch {
    return false;
  }
}

/**
 * 获取指定日期所在 ISO 周的所有 7 天（周一到周日）
 *
 * @param date  该周内的任意一天
 * @returns {Date[]} 包含 7 个 Date 对象的数组，从周一开始
 */
function getWeekDays(date: Date): Date[] {
  const d = new Date(date);
  // ISO 标准：周一=1, 周日=7。getDay() 中周日=0，所以将 0 转为 7
  const day = d.getDay() || 7; // Sunday = 7
  // 回退到本周周一
  d.setDate(d.getDate() - day + 1); // Back to Monday

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/**
 * 格式化事件为 Markdown 列表行
 *
 * @param evt  事件对象
 * @returns {string} 格式化的 Markdown 行，如：- `14:30` 📝 日志内容 [[链接]] #tag
 *
 * 注意：此函数与 diary.ts 中的 formatEventLine 功能相同，
 * 在此重复定义以避免循环依赖。
 */
function formatEventLine(evt: { time: string; icon: string; description: string; links: string[]; tags: string[] }): string {
  const linksStr = evt.links.length > 0 ? " " + evt.links.join(" ") : "";
  const tagsStr = evt.tags.length > 0 ? " " + evt.tags.join(" ") : "";
  return `- \`${evt.time}\` ${evt.icon} ${evt.description}${linksStr}${tagsStr}`;
}
