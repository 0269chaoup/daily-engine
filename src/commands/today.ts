/**
 * @file today 命令 — 今日概览
 *
 * 功能：显示指定日期（默认今日）的综合概览，包含：
 *   1. 当日日记中的所有事件
 *   2. Work/ 目录下所有活跃（Active）和阻塞（Blocked）的任务
 *
 * 这是一个只读命令，不会修改任何文件。
 *
 * 依赖：
 *   - commander        → CLI 命令框架
 *   - gray-matter      → YAML frontmatter 解析（用于读取任务状态）
 *   - lib/diary.ts     → readDiary, ensureDiary, formatEventLine (日记读取)
 *   - lib/path-utils.ts → WORK_DIR, formatDate, getISOWeek, relativeToVault (路径工具)
 *
 * 用法示例：
 *   daily-engine today                    # 显示今日概览
 *   daily-engine today --date 2024-01-15  # 显示指定日期概览
 */

import { Command } from "commander";
import fs from "fs";
import matter from "gray-matter";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { readDiary, ensureDiary, formatEventLine } from "../lib/diary.js";
import { WORK_DIR, formatDate, getISOWeek, relativeToVault } from "../lib/path-utils.js";
import path from "path";

/**
 * 创建 today 子命令
 *
 * @returns {Command} commander Command 实例
 *
 * 处理流程：
 *   1. 读取当日日记文件，输出所有事件
 *   2. 遍历 Work/ 目录下所有项目，找出状态为 Active 或 Blocked 的任务
 *   3. 以 wikilink 格式输出活跃任务列表
 */
export function todayCommand(): Command {
  return new Command("today")
    .description("Show today's summary — diary events + active tasks")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const date = opts.date ? new Date(opts.date + "T00:00:00") : new Date();
      const dateStr = formatDate(date);
      const { weekYear, week } = getISOWeek(date);

      // 输出标题栏
      console.log(`\n📅 ${dateStr}  (W${week}, ${weekYear})`);
      console.log("═".repeat(50));

      // === 部分 1：日记事件 ===
      const diary = readDiary(ctx.vault.root, date);
      if (diary) {
        section(`📄 Diary: ${diary.relPath}`);
        if (diary.events.length === 0) {
          console.log("  (no events yet)");
        } else {
          // 输出每个事件的格式化行
          for (const evt of diary.events) {
            console.log(`  ${formatEventLine(evt)}`);
          }
        }
      } else {
        section("📄 Diary");
        console.log("  (not created yet — run `daily-engine init`)");
      }

      // === 部分 2：活跃任务 ===
      section("🌿 Active Tasks (from Work/)");
      const workRoot = path.join(ctx.vault.root, WORK_DIR);
      if (!fs.existsSync(workRoot)) {
        console.log("  (no Work/ directory)");
        return;
      }

      /** 活跃任务计数 */
      let activeCount = 0;
      // 获取所有项目目录
      const projects = fs.readdirSync(workRoot).filter(d => {
        const full = path.join(workRoot, d);
        return fs.statSync(full).isDirectory();
      });

      // 遍历每个项目的任务文件
      for (const project of projects) {
        const projDir = path.join(workRoot, project);
        const files = fs.readdirSync(projDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");

        for (const file of files) {
          const filePath = path.join(projDir, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          try {
            const parsed = matter(raw);
            const status = parsed.data.status ?? "";
            // 只显示状态为 Active 或 Blocked 的任务
            if (status.includes("Active") || status.includes("Blocked")) {
              const icon = status.includes("Blocked") ? "🚧" : "🌿";
              // 优先使用 frontmatter 中的 title，否则从内容中提取一级标题
              const title = parsed.data.title ?? parsed.content.match(/^#\s+(.+)/m)?.[1] ?? file.replace(/\.md$/, "");
              const relPath = relativeToVault(ctx.vault.root, filePath);
              // 以 Obsidian wikilink 格式输出，显示 "项目: 标题"
              console.log(`  ${icon} [[${relPath.replace(/\.md$/, "")}|${project}: ${title}]]`);
              activeCount++;
            }
          } catch {
            // 跳过无法解析的文件
          }
        }
      }

      if (activeCount === 0) {
        console.log("  (no active tasks)");
      }

      console.log();
    });
}
