/**
 * @file 路径工具模块 (Path Utilities)
 *
 * 提供 Obsidian vault 中各类文件路径的生成、日期格式化和文件系统辅助函数。
 * 这是整个项目最底层的工具模块，不依赖项目内其他模块。
 *
 * 目录结构约定：
 *   vault/
 *   ├── 20-Daily/                    ← 日记根目录
 *   │   └── YYYY/
 *   │       └── MM/
 *   │           └── 第NN周/
 *   │               ├── YYYY-MM-DD.md        ← 每日日记
 *   │               └── YYYY-WNN_周复盘.md   ← 周复盘报告
 *   └── 30-Projects/
 *       └── Work/                    ← 工作任务根目录
 *           └── <project>/
 *               ├── INDEX.md
 *               └── <task>.md        ← 任务文件
 */

import fs from "fs";
import path from "path";

// ── 目录常量 ──────────────────────────────────────────────────────────────

/**
 * 日记目录名 —— Obsidian vault 中存放每日日记的根目录
 * 路径结构：20-Daily/YYYY/MM/第NN周/YYYY-MM-DD.md
 */
export const DAILY_DIR = "20-Daily";

/**
 * 工作任务目录名 —— Obsidian vault 中存放工作任务的根目录
 * 路径结构：30-Projects/Work/<project>/<task>.md
 */
export const WORK_DIR = "30-Projects/Work";

// ── ISO 周数计算 ──────────────────────────────────────────────────────────

/**
 * 计算日期的 ISO 周数和 ISO 周年份
 *
 * ISO 8601 标准：
 *   - 一周从周一开始
 *   - 一年的第一周是包含该年第一个星期四的那一周
 *   - 因此 12 月 31 日可能属于下一年的第 1 周
 *
 * @param date  输入日期
 * @returns { weekYear: number, week: number }
 *   - weekYear: ISO 周年份（可能与日历年不同）
 *   - week: ISO 周数（1-53）
 *
 * 算法：
 *   1. 将日期转为 UTC 避免时区问题
 *   2. 找到该周最近的星期四
 *   3. 用星期四所在的年份作为 weekYear
 *   4. 计算该星期四是该年的第几天，再转换为周数
 */
export function getISOWeek(date: Date): { weekYear: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // 找到最近的星期四：当前日期 + 4 - 当前星期几
  // getUTCDay() 中周日=0，需要转为 7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const weekYear = d.getUTCFullYear();
  // 计算该年 1 月 1 日
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  // 周数 = ceil((天数差 + 1) / 7)
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekYear, week };
}

// ── 路径生成 ──────────────────────────────────────────────────────────────

/**
 * 生成日记文件的完整路径
 *
 * @param vaultRoot  Obsidian vault 根目录的绝对路径
 * @param date       目标日期
 * @returns {string} 日记文件的绝对路径
 *
 * 路径格式：{vaultRoot}/20-Daily/{year}/{month}/第{week}周/{YYYY-MM-DD}.md
 * 示例：/vault/20-Daily/2024/01/第03周/2024-01-15.md
 */
export function getDiaryPath(vaultRoot: string, date: Date): string {
  const { weekYear, week } = getISOWeek(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const weekStr = String(week).padStart(2, "0");
  const dateStr = formatDate(date);

  return path.join(
    vaultRoot,
    DAILY_DIR,
    String(year),
    month,
    `第${weekStr}周`,
    `${dateStr}.md`
  );
}

/**
 * 生成周复盘文件的完整路径
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param date       该周内的任意一天
 * @returns {string} 周复盘文件的绝对路径
 *
 * 路径格式：{vaultRoot}/20-Daily/{year}/{month}/第{week}周/{year}-W{week}_周复盘.md
 * 示例：/vault/20-Daily/2024/01/第03周/2024-W03_周复盘.md
 */
export function getWeekReviewPath(vaultRoot: string, date: Date): string {
  const { weekYear, week } = getISOWeek(date);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const weekStr = String(week).padStart(2, "0");

  return path.join(
    vaultRoot,
    DAILY_DIR,
    String(year),
    month,
    `第${weekStr}周`,
    `${weekYear}-W${weekStr}_周复盘.md`
  );
}

/**
 * 生成月视图文件的完整路径
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param date       该月内的任意一天
 * @returns {string} 月视图文件的绝对路径
 *
 * 路径格式：{vaultRoot}/20-Daily/{year}/{month}/{year}-{month}_月视图.md
 * 示例：/vault/20-Daily/2024/01/2024-01_月视图.md
 */
export function getMonthViewPath(vaultRoot: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dateStr = `${year}-${month}`;

  return path.join(vaultRoot, DAILY_DIR, String(year), month, `${dateStr}_月视图.md`);
}

// ── 格式化函数 ──────────────────────────────────────────────────────────

/**
 * 将日期格式化为 YYYY-MM-DD 字符串
 *
 * @param date  输入日期
 * @returns {string} 格式化的日期字符串，如 "2024-01-15"
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 将时间格式化为 HH:MM 字符串
 *
 * @param date  输入日期/时间
 * @returns {string} 格式化的时间字符串，如 "14:30"
 */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// ── 路径转换工具 ──────────────────────────────────────────────────────────

/**
 * 获取相对于 vault 根目录的路径
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param absPath    绝对路径
 * @returns {string} 相对于 vault 的路径（使用 / 分隔符，兼容 Windows）
 *
 * 示例：relativeToVault("/vault", "/vault/20-Daily/2024/01/file.md")
 *        → "20-Daily/2024/01/file.md"
 */
export function relativeToVault(vaultRoot: string, absPath: string): string {
  // 统一使用 / 作为路径分隔符（Obsidian 使用 Unix 风格路径）
  return path.relative(vaultRoot, absPath).replace(/\\/g, "/");
}

/**
 * 将相对路径转换为 Obsidian wikilink 格式
 *
 * @param relativePath  相对于 vault 的路径
 * @param alias         可选的显示别名
 * @returns {string} wikilink 字符串
 *
 * 示例：
 *   toWikilink("20-Daily/2024/01/file.md")
 *     → "[[20-Daily/2024/01/file]]"
 *   toWikilink("30-Projects/Work/MyProject/task.md", "MyProject: 任务名")
 *     → "[[30-Projects/Work/MyProject/task|MyProject: 任务名]]"
 */
export function toWikilink(relativePath: string, alias?: string): string {
  // 移除 .md 扩展名（Obsidian wikilink 不需要扩展名）
  const noExt = relativePath.replace(/\.md$/, "");
  return alias ? `[[${noExt}|${alias}]]` : `[[${noExt}]]`;
}

/**
 * 确保文件的父目录存在（递归创建）
 *
 * @param filePath  文件路径
 *
 * 使用场景：创建日记或周复盘文件前，确保目录结构已就绪。
 */
export function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
