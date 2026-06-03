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
import { WORK_DIR, relativeToVault, toWikilink } from "./path-utils.js";

// ── 接口定义 ─────────────────────────────────────────────────────────────

/**
 * 任务信息接口 —— 描述一个工作任务的完整信息
 *
 * @property absPath      任务文件的绝对路径
 * @property relPath      相对于 vault 根目录的路径
 * @property wikilink     Obsidian wikilink 格式的链接，如 "[[30-Projects/Work/...]]"
 * @property alias        显示别名，格式为 "项目: 标题"
 * @property project      所属项目名称
 * @property title        任务标题
 * @property status       当前状态（emoji + 文字），如 "🌱 Planned", "🌿 Active", "🍂 Completed"
 * @property frontmatter  完整的 YAML frontmatter 数据
 */
export interface TaskInfo {
  absPath: string;
  relPath: string;
  wikilink: string;
  alias: string;
  project: string;
  title: string;
  status: string;
  frontmatter: Record<string, unknown>;
}

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

/**
 * 在指定项目目录中查找任务文件（支持模糊匹配）
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param project    项目名称
 * @param title      任务标题
 * @returns {string | null} 任务文件的绝对路径，未找到返回 null
 *
 * 查找策略：
 *   1. 精确匹配：清理标题为文件名格式，检查文件是否存在
 *   2. 模糊搜索：将标题拆分为单词，检查每个文件名是否包含所有单词
 */
export function findTaskFile(
  vaultRoot: string,
  project: string,
  title: string
): string | null {
  const workDir = path.join(vaultRoot, WORK_DIR, project);
  if (!fs.existsSync(workDir)) return null;

  // 精确匹配：将标题转为合法文件名后查找
  const sanitized = sanitizeFilename(title);
  const exactPath = path.join(workDir, `${sanitized}.md`);
  if (fs.existsSync(exactPath)) return exactPath;

  // 模糊搜索：标题中的所有单词都出现在文件名中即匹配
  const files = fs.readdirSync(workDir).filter(f => f.endsWith(".md") && f !== "INDEX.md");
  const titleWords = title.toLowerCase().split(/\s+/);

  for (const file of files) {
    const name = file.replace(/\.md$/, "").toLowerCase();
    if (titleWords.every(w => name.includes(w))) {
      return path.join(workDir, file);
    }
  }

  return null;
}

/**
 * 跨所有项目全局查找任务文件
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param title      任务标题
 * @returns {TaskInfo | null} 任务信息，未找到返回 null
 *
 * 遍历 Work/ 下所有项目目录，调用 findTaskFile 查找。
 * 返回第一个匹配的任务。
 */
export function findTaskFileGlobal(
  vaultRoot: string,
  title: string
): TaskInfo | null {
  const workRoot = path.join(vaultRoot, WORK_DIR);
  if (!fs.existsSync(workRoot)) return null;

  // 获取所有项目目录
  const projects = fs.readdirSync(workRoot).filter(d => {
    const full = path.join(workRoot, d);
    return fs.statSync(full).isDirectory();
  });

  // 遍历每个项目查找
  for (const project of projects) {
    const absPath = findTaskFile(vaultRoot, project, title);
    if (absPath) {
      return buildTaskInfo(vaultRoot, absPath, project, title);
    }
  }

  return null;
}

/**
 * 从已存在的任务文件中读取任务信息
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param absPath    任务文件的绝对路径
 * @returns {TaskInfo | null} 任务信息，文件不存在返回 null
 *
 * 从文件路径中推断项目名（30-Projects/Work/<project>/file.md 中的 <project>），
 * 从 frontmatter 中读取标题和状态。
 */
export function readTaskInfo(vaultRoot: string, absPath: string): TaskInfo | null {
  if (!fs.existsSync(absPath)) return null;

  const raw = fs.readFileSync(absPath, "utf-8");
  const parsed = matter(raw);
  const relPath = relativeToVault(vaultRoot, absPath);
  // 从路径中提取项目名：30-Projects/Work/<project>/file.md → <project>
  const parts = relPath.split("/");
  const project = parts.length >= 4 ? parts[2] : "General";
  // 提取标题：优先 frontmatter title，其次内容中的一级标题，最后用文件名
  const title = parsed.data.title ?? parsed.content.match(/^#\s+(.+)/m)?.[1] ?? path.basename(absPath, ".md");

  return {
    absPath,
    relPath,
    wikilink: toWikilink(relPath),
    alias: `${project}: ${title}`,
    project,
    title: String(title),
    status: parsed.data.status ?? "🌱 Planned",
    frontmatter: parsed.data,
  };
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

/**
 * 将标题字符串清理为合法的文件名
 *
 * @param name  原始标题
 * @returns {string} 清理后的文件名
 *
 * 处理规则：
 *   1. 替换文件系统不允许的字符（/\:*?"<>|）为连字符
 *   2. 将空白字符替换为连字符
 *   3. 合并连续的连字符
 *   4. 去除首尾的连字符
 *   5. 截断到 80 字符
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

/**
 * 对字符串进行 shell 安全引用
 *
 * @param s  原始字符串
 * @returns {string} shell 引用后的字符串
 *
 * 使用单引号包裹，内部的单引号通过 '\'' 转义。
 * 示例：shellQuote("it's") → "'it'\''s'"
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
