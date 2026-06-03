/**
 * @file sync 命令 — 同步日记 checkbox 状态到工作任务文件
 *
 * 功能：读取日记的 ## 任务 区域中的 checkbox 状态，
 *       将完成/待办状态同步到对应的工作任务文件。
 *
 * 接口：
 *   daily sync [--date YYYY-MM-DD] [--dry-run]
 *
 * 处理流程：
 *   1. 读取指定日期的日记文件
 *   2. 解析 ## 任务 区域中的 checkbox 行
 *   3. 对每个 checkbox，查找对应的工作任务文件
 *   4. 根据 checkbox 状态更新任务文件的 frontmatter status
 *
 * 依赖：
 *   - lib/cli-utils.ts   → buildContext, row, section
 *   - lib/diary.ts        → readDiary
 *   - lib/work-bridge.ts  → findTaskFileGlobal
 *   - lib/path-utils.ts   → formatDate
 */

import { Command } from "commander";
import fs from "fs";
import matter from "gray-matter";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { readDiary } from "../lib/diary.js";
import { findTaskFileGlobal } from "../lib/work-bridge.js";
import { formatDate } from "../lib/path-utils.js";

/** 从日记正文的 ## 任务 区域解析 checkbox 行 */
function parseTaskCheckboxes(body: string): Array<{ checked: boolean; title: string }> {
  const items: Array<{ checked: boolean; title: string }> = [];
  const lines = body.split("\n");

  let inTaskSection = false;
  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 section 边界
    if (trimmed.startsWith("## ")) {
      inTaskSection = trimmed === "## 任务";
      continue;
    }

    if (!inTaskSection) continue;

    // 匹配 checkbox：- [ ] 标题 或 - [x] 标题
    const match = trimmed.match(/^- \[([ xX])\] (.+)$/);
    if (match) {
      const checked = match[1].toLowerCase() === "x";
      const title = match[2].trim();
      items.push({ checked, title });
    }
  }

  return items;
}

/**
 * 创建 sync 子命令
 *
 * @returns {Command} commander Command 实例
 */
export function syncCommand(): Command {
  return new Command("sync")
    .description("Sync diary checkbox states to Work/ task files")
    .option("--date <date>", "Date (YYYY-MM-DD), default: today")
    .option("--dry-run", "Show what would be synced without making changes", false)
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const now = new Date();
      const date = opts.date ? new Date(opts.date + "T00:00:00") : now;
      const dateStr = formatDate(date);

      // 步骤 1：读取日记
      section(`① Reading diary for ${dateStr}`);
      const diary = readDiary(ctx.vault.root, date);
      if (!diary) {
        console.error(`\n❌ Diary not found for ${dateStr}\n`);
        process.exit(1);
      }
      row("Diary", diary.relPath, "📅");

      // 步骤 2：解析 checkbox
      section("② Parsing task checkboxes");
      const checkboxes = parseTaskCheckboxes(diary.body);
      if (checkboxes.length === 0) {
        console.log("\n  No task checkboxes found in ## 任务 section.\n");
        return;
      }
      row("Checkboxes", checkboxes.length, "📋");

      // 步骤 3：同步每个 checkbox
      section("③ Syncing tasks");

      let synced = 0;
      let skipped = 0;
      let notFound = 0;

      for (const item of checkboxes) {
        const targetStatus = item.checked ? "🍂 Completed" : "🌿 Active";
        const icon = item.checked ? "✅" : "⬜";

        // 全局查找任务文件（findTaskFileGlobal 返回 TaskInfo | null）
        const taskInfo = findTaskFileGlobal(ctx.vault.root, item.title);

        if (!taskInfo) {
          console.log(`  ${icon} ⚠️  Task not found: ${item.title}`);
          notFound++;
          continue;
        }

        const absPath = taskInfo.absPath;
        const currentStatus = taskInfo.status;

        // 检查是否需要更新
        const isAlreadyCorrect =
          (item.checked && currentStatus === "🍂 Completed") ||
          (!item.checked && currentStatus !== "🍂 Completed");

        if (isAlreadyCorrect) {
          if (ctx.verbose) {
            console.log(`  ${icon} ⏭️  Already in sync: ${item.title} (${currentStatus})`);
          }
          skipped++;
          continue;
        }

        if (opts.dryRun) {
          console.log(`  ${icon} 🔄 Would sync: ${item.title} (${currentStatus} → ${targetStatus})`);
          synced++;
          continue;
        }

        // 更新任务状态
        const raw = fs.readFileSync(absPath, "utf-8");
        const parsed = matter(raw);
        parsed.data.status = targetStatus;

        // 如果标记为完成，添加 completed_at 日期
        if (item.checked) {
          parsed.data.completed_at = dateStr;
        } else {
          // 如果取消完成，移除 completed 相关字段
          delete parsed.data.completed_at;
          delete parsed.data.completed_log;
        }

        const newContent = matter.stringify(parsed.content, parsed.data);
        fs.writeFileSync(absPath, newContent, "utf-8");

        console.log(`  ${icon} ✅ Synced: ${item.title} → ${targetStatus}`);
        synced++;
      }

      // 汇总
      console.log("");
      row("Synced", synced, "🔄");
      row("Skipped (already in sync)", skipped, "⏭️");
      row("Not found", notFound, "⚠️");
      console.log("");
    });
}
