/**
 * @file 工作任务桥接模块 (Work Bridge)
 *
 * 提供与 Work/ 目录下工作任务文件交互的功能。
 * 这是 daily-engine 与 Obsidian vault 中任务文件之间的桥梁。
 *
 * 职责：
 *   1. 创建任务 —— 优先通过 work-engine CLI 创建，回退到直接创建
 *   2. 查找任务 —— 支持精确匹配和模糊搜索
 *   3. 读取任务 —— 解析任务文件的 frontmatter 和内容
 *
 * 目录结构：
 *   30-Projects/Work/<project>/<task-title>.md
 *
 * 任务文件结构：
 *   ---
 *   type: Task
 *   project: <project>
 *   status: "🌱 Planned"
 *   created: '2024-01-15'
 *   created_log: "[[20-Daily/...]]"
 *   created_at: "2024-01-15"
 *   ---
 *   # <title>
 *
 * 依赖：
 *   - child_process     → execSync (调用 work-engine CLI)
 *   - fs/path           → 文件系统操作
 *   - gray-matter       → YAML frontmatter 解析
 *   - lib/path-utils.ts → WORK_DIR, relativeToVault, toWikilink
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  WORK_DIR,
  relativeToVault,
  toWikilink,
  findTaskFile,
  findTaskFileGlobal,
  readTaskInfo,
  sanitizeFilename,
  shellQuote,
} from "@hermes/vault-utils";
import type { TaskInfo } from "@hermes/vault-utils";

// Re-export shared symbols so downstream files can still import from work-bridge
export { TaskInfo, findTaskFile, findTaskFileGlobal, readTaskInfo };

// ── 工作引擎桥接 ─────────────────────────────────────────────────────────

/**
 * 通过 work-engine CLI 创建任务，返回任务信息
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param project    项目名称（对应 Work/ 下的子目录）
 * @param title      任务标题
 * @param options    可选配置
 * @param options.type    任务类型
 * @param options.status  初始状态
 * @param options.group   任务分组列表
 * @returns {TaskInfo} 创建的任务信息
 * @throws {Error} 创建失败时抛出错误
 *
 * 创建策略（优先级从高到低）：
 *   1. 调用 work-engine CLI（如果系统中安装了）
 *   2. 如果 work-engine 不存在（ENOENT），直接创建任务文件
 *   3. 如果任务已存在，查找并返回已有任务
 */
export function createTaskViaEngine(
  vaultRoot: string,
  project: string,
  title: string,
  options?: { type?: string; status?: string; group?: string[] }
): TaskInfo {
  // 构建 work-engine 命令参数
  const args = [
    "work-engine",
    "work",
    "task",
    "create",
    shellQuote(project),
    shellQuote(title),
  ];

  // 添加可选的分组参数
  if (options?.group) {
    for (const g of options.group) {
      args.push("--group", shellQuote(g));
    }
  }

  // 构建完整命令，设置 OBSIDIAN_VAULT 环境变量
  const cmd = `OBSIDIAN_VAULT=${shellQuote(vaultRoot)} ${args.join(" ")}`;

  try {
    // 执行 work-engine 命令
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 10000, // 10 秒超时
      stdio: ["pipe", "pipe", "pipe"],
    });
    // 从输出中解析创建的文件路径
    const match = output.match(/Created (?:task note|work note): (.+\.md)/);
    if (match) {
      const absPath = path.resolve(vaultRoot, match[1]);
      return buildTaskInfo(vaultRoot, absPath, project, title);
    }
  } catch (err: any) {
    // work-engine 命令不存在，回退到直接创建
    if (err.code === "ENOENT" || err.status === 127) {
      console.warn("⚠️  work-engine not found, creating task file directly");
      return createTaskDirectly(vaultRoot, project, title);
    }
    // 任务已存在，查找并返回
    if (err.stderr?.includes("Already exists") || err.stdout?.includes("Already exists")) {
      const absPath = findTaskFile(vaultRoot, project, title);
      if (absPath) {
        return buildTaskInfo(vaultRoot, absPath, project, title);
      }
    }
    throw new Error(`work-engine failed: ${err.message}\n${err.stderr ?? ""}`);
  }

  throw new Error("work-engine returned unexpected output");
}

// ── 内部辅助函数 ─────────────────────────────────────────────────────────

/**
 * 构建 TaskInfo 对象
 *
 * @param vaultRoot  vault 根目录
 * @param absPath    任务文件绝对路径
 * @param project    项目名称
 * @param title      任务标题
 * @returns {TaskInfo} 构建的任务信息对象
 */
function buildTaskInfo(
  vaultRoot: string,
  absPath: string,
  project: string,
  title: string
): TaskInfo {
  const relPath = relativeToVault(vaultRoot, absPath);
  const raw = fs.readFileSync(absPath, "utf-8");
  const parsed = matter(raw);

  return {
    absPath,
    relPath,
    wikilink: toWikilink(relPath),
    alias: `${project}: ${title}`,
    project,
    title,
    status: parsed.data.status ?? "🌱 Planned",
    frontmatter: parsed.data,
  };
}

/**
 * 直接创建任务文件（当 work-engine 不可用时的回退方案）
 *
 * @param vaultRoot  vault 根目录
 * @param project    项目名称
 * @param title      任务标题
 * @returns {TaskInfo} 创建的任务信息
 *
 * 创建一个带有标准 frontmatter 的 Markdown 文件，
 * 包含 type、project、status、created 字段。
 */
function createTaskDirectly(
  vaultRoot: string,
  project: string,
  title: string
): TaskInfo {
  const workDir = path.join(vaultRoot, WORK_DIR, project);
  fs.mkdirSync(workDir, { recursive: true });

  const filename = sanitizeFilename(title);
  const absPath = path.join(workDir, `${filename}.md`);
  const dateStr = new Date().toISOString().split("T")[0];

  // 标准任务模板
  const content = `---
type: Task
project: ${project}
status: "🌱 Planned"
created: '${dateStr}'
---

# ${title}
`;

  fs.writeFileSync(absPath, content, "utf-8");
  return buildTaskInfo(vaultRoot, absPath, project, title);
}


