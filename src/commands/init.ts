/**
 * @file init 命令 — 初始化日记
 *
 * 功能：创建或读取指定日期的日记文件。
 * 日记文件路径遵循 Obsidian vault 目录结构：20-Daily/YYYY/MM/第NN周/YYYY-MM-DD.md
 * 如果日记文件不存在则创建，已存在则直接读取。
 *
 * 依赖：
 *   - lib/cli-utils.ts  → buildContext, row, section (CLI 输出格式化)
 *   - lib/diary.ts      → ensureDiary (确保日记文件存在)
 *   - lib/path-utils.ts → formatDate, getDiaryPath, getISOWeek, relativeToVault (路径和日期工具)
 *
 * 用法示例：
 *   daily-engine init                    # 初始化今日日记
 *   daily-engine init --date 2024-01-15  # 初始化指定日期的日记
 */

import { Command } from "commander";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { ensureDiary } from "../lib/diary.js";
import { formatDate, getDiaryPath, getISOWeek, relativeToVault } from "../lib/path-utils.js";

/**
 * 创建 init 子命令
 *
 * @returns {Command} commander Command 实例，用于注册到主程序
 *
 * 处理流程：
 *   1. 通过 buildContext 构建 CLI 上下文（获取 vault 路径等配置）
 *   2. 解析目标日期（默认今日）
 *   3. 调用 ensureDiary 确保日记文件存在（不存在则创建）
 *   4. 输出日记的日期、周数、路径和已有事件数量
 */
export function initCommand(): Command {
  return new Command("init")
    .description("Initialize today's diary (create if not exists)")
    .option("--date <date>", "Date to initialize (YYYY-MM-DD), default: today")
    .action((opts, cmd) => {
      // 从父命令获取全局选项，构建 CLI 上下文
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      // 解析目标日期，如果指定了 --date 则使用指定日期，否则使用当前时间
      const date = opts.date ? new Date(opts.date + "T00:00:00") : new Date();
      // 确保日记文件存在（读取已有的或创建新的）
      const diary = ensureDiary(ctx.vault.root, date);
      // 获取日记文件相对于 vault 根目录的路径
      const relPath = relativeToVault(ctx.vault.root, diary.absPath);
      // 计算 ISO 周数信息
      const { weekYear, week } = getISOWeek(date);

      // 格式化输出日记初始化结果
      console.log(`\n📅 Diary initialized`);
      row("Date", formatDate(date), "📆");
      row("Week", `W${week} (${weekYear})`, "📋");
      row("Path", relPath, "📄");
      row("Events", String(diary.events.length), "📝");
      console.log();
    });
}
