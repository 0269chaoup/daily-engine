/**
 * @file link 命令 — 双向链接校验
 *
 * 功能：校验 Work/ 目录下任务文件与 Daily/ 日记之间的双向链接完整性。
 * 检查项目包括：
 *   1. created_log  — 任务是否有创建日志链接字段
 *   2. dead_link    — 链接指向的日记文件是否存在
 *   3. completed_log — 完成链接指向的文件是否存在
 *
 * 支持 --fix 选项：自动根据任务的 created 日期推断并填充缺失的 created_log 字段。
 *
 * 依赖：
 *   - commander        → CLI 命令框架
 *   - gray-matter      → YAML frontmatter 解析
 *   - lib/cli-utils    → CLI 上下文和输出格式化
 *   - lib/path-utils   → 路径常量、日期格式化、wikilink 生成
 *
 * 用法示例：
 *   daily-engine link                    # 检查所有项目的链接
 *   daily-engine link -p MyProject       # 只检查指定项目
 *   daily-engine link --fix              # 自动修复缺失的 created_log
 */

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
  getISOWeek,
  getDiaryPath,
} from "../lib/path-utils.js";

/**
 * 链接问题接口 — 描述一个发现的链接完整性问题
 *
 * @property type        问题类型：
 *                         - "missing_created_log": 任务缺少 created_log 字段
 *                         - "missing_diary_event": 日记缺少对应事件
 *                         - "orphan_diary_link":    孤立的日记链接
 *                         - "dead_link":           链接指向不存在的文件
 * @property taskFile    相关的任务文件路径（相对于 vault）
 * @property diaryFile   相关的日记文件路径（相对于 vault）
 * @property detail      问题的详细描述信息
 */
interface LinkIssue {
  type: "missing_created_log" | "missing_diary_event" | "orphan_diary_link" | "dead_link";
  taskFile?: string;
  diaryFile?: string;
  detail: string;
}

/**
 * 创建 link 子命令
 *
 * @returns {Command} commander Command 实例
 *
 * 处理流程：
 *   1. 遍历 Work/ 下所有项目目录中的任务文件
 *   2. 解析每个任务文件的 frontmatter
 *   3. 检查 created_log 是否存在且指向有效文件
 *   4. 检查 completed_log 是否指向有效文件
 *   5. 如果指定了 --fix，自动为缺失 created_log 的任务补充链接
 *   6. 按问题类型汇总并输出报告
 */
export function linkCommand(): Command {
  return new Command("link")
    .description("Validate dual links between Work/ tasks and Daily/ diary events")
    .option("-p, --project <name>", "Limit to a specific project")
    .option("--fix", "Attempt to fix missing created_log fields", false)
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      /** 收集所有发现的链接问题 */
      const issues: LinkIssue[] = [];
      /** 已检查的任务文件计数 */
      let checked = 0;

      console.log(`\n🔗 Checking dual links...\n`);

      // 获取 Work 目录路径
      const workRoot = path.join(ctx.vault.root, WORK_DIR);
      if (!fs.existsSync(workRoot)) {
        console.log("  (no Work/ directory)");
        return;
      }

      // 获取所有项目目录（Work/ 下的子目录）
      const projects = fs.readdirSync(workRoot).filter(d => {
        const full = path.join(workRoot, d);
        return fs.statSync(full).isDirectory();
      });

      // 如果指定了项目名，只检查该项目
      const filteredProjects = opts.project ? projects.filter(p => p === opts.project) : projects;

      // 遍历每个项目目录
      for (const project of filteredProjects) {
        const projDir = path.join(workRoot, project);
        // 获取项目下所有 markdown 文件（排除 INDEX.md）
        const files = fs.readdirSync(projDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");

        for (const file of files) {
          const filePath = path.join(projDir, file);
          const raw = fs.readFileSync(filePath, "utf-8");
          try {
            const parsed = matter(raw);
            const relPath = relativeToVault(ctx.vault.root, filePath);
            checked++;

            // 检查项 1：任务是否有 created_log 字段
            if (!parsed.data.created_log) {
              issues.push({
                type: "missing_created_log",
                taskFile: relPath,
                detail: `No created_log field`,
              });

              // 如果启用了 --fix，尝试根据 created 日期自动推断 created_log
              if (opts.fix && parsed.data.created) {
                let createdDate: Date;
                const created = parsed.data.created;
                // 处理不同格式的日期值（Date 对象、字符串等）
                if (created instanceof Date) {
                  createdDate = created;
                } else if (typeof created === "string") {
                  createdDate = new Date(created.replace(/'/g, ""));
                } else {
                  createdDate = new Date(String(created));
                }
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

            // 检查项 2：如果 created_log 存在，验证其指向的日记文件是否真实存在
            if (parsed.data.created_log) {
              // 从 wikilink 中提取日记路径：[[path]] → path
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

            // 检查项 3：同样检查 completed_log 指向的文件是否存在
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
          } catch { /* 跳过无法解析的文件 */ }
        }
      }

      // 输出检查报告
      if (issues.length === 0) {
        console.log(`✅ All ${checked} task files have valid dual links.\n`);
        return;
      }

      // 按问题类型分组
      const byType = new Map<string, LinkIssue[]>();
      for (const issue of issues) {
        const existing = byType.get(issue.type) ?? [];
        existing.push(issue);
        byType.set(issue.type, existing);
      }

      // 按类型输出问题详情
      for (const [type, typeIssues] of byType) {
        const icon = type === "dead_link" ? "❌" : "⚠️";
        section(`${icon} ${type} (${typeIssues.length})`);
        for (const issue of typeIssues) {
          console.log(`  ${issue.taskFile ?? issue.diaryFile}: ${issue.detail}`);
        }
      }

      // 输出统计摘要
      console.log(`\n${"═".repeat(50)}`);
      console.log(`Checked: ${checked} | Issues: ${issues.length}`);
      // 如果存在缺失 created_log 且未启用 --fix，提示用户可以修复
      if (!opts.fix && issues.some(i => i.type === "missing_created_log")) {
        console.log(`\n💡 Run with --fix to auto-fill missing created_log fields from task created date.`);
      }
      console.log();
    });
}

/**
 * 辅助函数：获取指定日期的日记文件路径
 *
 * @param vaultRoot  Obsidian vault 根目录的绝对路径
 * @param date       目标日期
 * @returns {string | null} 日记文件的绝对路径
 *
 * 注意：此函数是对 getDiaryPath 的简单封装，保持语义一致性
 */
function getDiaryPathForDate(vaultRoot: string, date: Date): string | null {
  return getDiaryPath(vaultRoot, date);
}
