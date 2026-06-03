/**
 * @file 日记核心模块 (Diary Core)
 *
 * 提供日记文件的读写、事件追加、任务链接管理等核心功能。
 * 这是 daily-engine 的核心模块，几乎所有命令都依赖它。
 *
 * 职责：
 *   1. 日记文件的创建和读取（readDiary, createDiary, ensureDiary）
 *   2. 事件解析和追加（parseEvents, appendEvent, formatEventLine）
 *   3. 任务文件 frontmatter 中的日记链接管理（updateTaskDiaryLink, removeTaskBlockedFields）
 *
 * 日记文件结构：
 *   ---                    ← YAML frontmatter 开始
 *   date: 2024-01-15
 *   ---                    ← YAML frontmatter 结束
 *   # 2024-01-15           ← 标题
 *   ## 任务                ← 任务 section
 *   ## 日志                ← 日志 section（事件追加到此处）
 *   ## 学习
 *   ## Note
 *
 * 事件格式：- `HH:MM` 📝 描述 [[链接]] #tag
 *
 * 依赖：
 *   - fs                → 文件系统操作
 *   - gray-matter       → YAML frontmatter 解析和序列化
 *   - path              → 路径处理
 *   - lib/path-utils.ts → 路径生成、日期格式化等工具函数
 */

import fs from "fs";
import matter from "gray-matter";
import path from "path";
import {
  DAILY_DIR,
  getDiaryPath,
  getWeekReviewPath,
  formatDate,
  formatTime,
  relativeToVault,
  toWikilink,
  ensureDir,
  getISOWeek,
} from "./path-utils.js";

// ── 接口定义 ─────────────────────────────────────────────────────────────

/**
 * 日记 frontmatter 接口 —— 描述日记文件的 YAML 元数据
 *
 * @property date       日期字符串，格式 YYYY-MM-DD
 * @property tags       可选的标签列表
 * @property [key:string] 允许任意额外的 frontmatter 字段
 */
export interface DiaryFrontmatter {
  date: string;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * 日记事件接口 —— 描述一条日志事件的所有信息
 *
 * @property time        时间，格式 HH:MM
 * @property icon        事件图标（emoji），如 🆕 ✅ 📝 🚧 🔓 💡 📌
 * @property description 事件描述文本
 * @property links       相关的 wikilink 链接列表
 * @property tags        标签列表，如 #task-created, #log
 *
 * 在日记文件中的渲染格式：- `14:30` 📝 描述 [[链接]] #tag
 */
export interface DiaryEvent {
  time: string;       // HH:MM
  icon: string;       // 🆕 ✅ 📝 🚧 🔓 etc.
  description: string;
  links: string[];    // wikilinks
  tags: string[];     // #task-created etc.
}

/**
 * 日记文件接口 —— 描述一个完整的日记文件
 *
 * @property absPath      日记文件的绝对路径
 * @property relPath      相对于 vault 根目录的路径
 * @property frontmatter  YAML frontmatter 数据
 * @property body         文件正文内容（不含 frontmatter）
 * @property events       从正文中解析出的事件列表
 */
export interface DiaryFile {
  absPath: string;
  relPath: string;
  frontmatter: DiaryFrontmatter;
  body: string;
  events: DiaryEvent[];
}

// ── 事件图标常量 ──────────────────────────────────────────────────────────

/**
 * 事件图标映射表 —— 定义各类事件对应的 emoji 图标
 *
 * 使用 as const 确保类型安全，防止意外修改。
 * 各命令在追加事件时使用这些图标：
 *   - created:    🆕 新建任务
 *   - completed:  ✅ 完成任务
 *   - log:        📝 日志记录
 *   - blocked:    🚧 任务阻塞
 *   - unblocked:  🔓 解除阻塞
 *   - insight:    💡 洞察/发现
 *   - note:       📌 笔记/标记
 */
export const EVENT_ICONS = {
  created: "🆕",
  completed: "✅",
  log: "📝",
  blocked: "🚧",
  unblocked: "🔓",
  insight: "💡",
  note: "📌",
} as const;

// ── 日记读写 ────────────────────────────────────────────────────────────

/**
 * 读取已存在的日记文件
 *
 * @param vaultRoot  Obsidian vault 根目录的绝对路径
 * @param date       目标日期
 * @returns {DiaryFile | null} 日记文件对象，如果文件不存在返回 null
 *
 * 处理流程：
 *   1. 根据日期计算日记文件路径
 *   2. 检查文件是否存在
 *   3. 读取并解析 YAML frontmatter
 *   4. 从正文中解析事件列表
 */
export function readDiary(vaultRoot: string, date: Date): DiaryFile | null {
  const absPath = getDiaryPath(vaultRoot, date);
  if (!fs.existsSync(absPath)) return null;

  const raw = fs.readFileSync(absPath, "utf-8");
  const parsed = matter(raw);
  const relPath = relativeToVault(vaultRoot, absPath);

  return {
    absPath,
    relPath,
    frontmatter: parsed.data as DiaryFrontmatter,
    body: parsed.content,
    events: parseEvents(parsed.content),
  };
}

/**
 * 创建新的日记文件（使用标准模板）
 *
 * @param vaultRoot  Obsidian vault 根目录的绝对路径
 * @param date       目标日期
 * @returns {DiaryFile} 新创建的日记文件对象
 *
 * 模板包含：
 *   - YAML frontmatter（date 字段）
 *   - 导航链接（年视图、月视图、周复盘）
 *   - 标准 section：任务、日志、学习、Note
 */
export function createDiary(vaultRoot: string, date: Date): DiaryFile {
  const absPath = getDiaryPath(vaultRoot, date);
  // 确保父目录存在（递归创建）
  ensureDir(absPath);

  const dateStr = formatDate(date);
  const { weekYear, week } = getISOWeek(date);
  const weekStr = String(week).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");

  // 构建 Obsidian wikilink 导航链接
  const yearView = `[[${date.getFullYear()}_年视图]]`;
  const monthView = `[[${date.getFullYear()}-${month}_月视图]]`;
  const weekReview = `[[${weekYear}-W${weekStr}_周复盘]]`;

  // 日记模板内容
  const content = `---
date: ${dateStr}
---

${yearView} / ${monthView} / ${weekReview}

# ${dateStr}

## 任务

## 日志

## 学习

## Note
`;

  fs.writeFileSync(absPath, content, "utf-8");

  return {
    absPath,
    relPath: relativeToVault(vaultRoot, absPath),
    frontmatter: { date: dateStr },
    body: `\n${yearView} / ${monthView} / ${weekReview}\n\n# ${dateStr}\n\n## 任务\n\n## 日志\n\n## 学习\n\n## Note\n`,
    events: [],
  };
}

/**
 * 确保日记文件存在 —— 读取已有的或创建新的
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param date       目标日期
 * @returns {DiaryFile} 日记文件对象
 *
 * 这是最常用的日记获取方式，大多数命令都通过此函数获取日记。
 */
export function ensureDiary(vaultRoot: string, date: Date): DiaryFile {
  return readDiary(vaultRoot, date) ?? createDiary(vaultRoot, date);
}

// ── 事件追加 ────────────────────────────────────────────────────────────

/**
 * 向日记的"日志"section 追加一条事件
 *
 * @param vaultRoot  Obsidian vault 根目录
 * @param date       目标日期
 * @param event      要追加的事件对象
 *
 * 关键逻辑：
 *   1. 确保日记文件存在
 *   2. 读取文件内容并按行分割
 *   3. 查找 "## 日志" 标题行的位置
 *   4. 找到该 section 的末尾（下一个 ## 标题或文件末尾）
 *   5. 在 section 末尾插入格式化的事件行
 *   6. 写回文件
 *
 * 如果日记中没有 "## 日志" section，会自动在文件末尾添加。
 */
export function appendEvent(
  vaultRoot: string,
  date: Date,
  event: DiaryEvent
): void {
  const diary = ensureDiary(vaultRoot, date);
  const eventLine = formatEventLine(event);

  // 读取日记文件内容
  const raw = fs.readFileSync(diary.absPath, "utf-8");
  const lines = raw.split("\n");

  // 查找 "## 日志" section 的起始位置
  let logSectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## 日志") {
      logSectionIdx = i;
      break;
    }
  }

  if (logSectionIdx === -1) {
    // 没有找到日志 section，在文件末尾添加
    lines.push("", "## 日志", eventLine);
  } else {
    // 跳过 section 标题后的空行和引用描述行
    let insertIdx = logSectionIdx + 1;
    while (insertIdx < lines.length) {
      const line = lines[insertIdx].trim();
      if (line === "" || line.startsWith("> ")) {
        insertIdx++;
        continue;
      }
      break;
    }

    // 扫描到日志 section 的末尾（下一个 ## 标题或文件结束）
    let endIdx = insertIdx;
    while (endIdx < lines.length) {
      const line = lines[endIdx].trim();
      if (line.startsWith("## ") && endIdx > logSectionIdx) {
        break; // 遇到下一个 section，停止
      }
      endIdx++;
    }

    // 在 section 末尾（下一个 section 之前）插入事件行
    lines.splice(endIdx, 0, eventLine);
  }

  fs.writeFileSync(diary.absPath, lines.join("\n"), "utf-8");
}

/**
 * 将事件格式化为 Markdown 列表行
 *
 * @param event  事件对象
 * @returns {string} 格式化的字符串，如：- `14:30` 📝 描述 [[链接]] #tag
 */
export function formatEventLine(event: DiaryEvent): string {
  const linksStr = event.links.length > 0 ? " " + event.links.join(" ") : "";
  const tagsStr = event.tags.length > 0 ? " " + event.tags.join(" ") : "";
  return `- \`${event.time}\` ${event.icon} ${event.description}${linksStr}${tagsStr}`;
}

/**
 * 从日记正文中解析事件列表
 *
 * @param body  日记正文（不含 frontmatter）
 * @returns {DiaryEvent[]} 解析出的事件数组
 *
 * 解析规则：
 *   - 匹配以 "- `HH:MM`" 开头，后跟已知图标的行
 *   - 从匹配行中提取 wikilinks 和 tags
 *   - 剩余文本作为 description
 *
 * 正则匹配格式：- `HH:MM` 🆕|✅|📝|🚧|🔓|💡|📌 描述内容
 */
function parseEvents(body: string): DiaryEvent[] {
  const events: DiaryEvent[] = [];
  const lines = body.split("\n");

  for (const line of lines) {
    // 匹配事件行格式
    const match = line.match(
      /^- `(\d{2}:\d{2})`\s+(🆕|✅|📝|🚧|🔓|💡|📌)\s+(.+)/
    );
    if (match) {
      const [, time, icon, rest] = match;
      // 从描述中提取 wikilinks 和 tags
      const wikilinks: string[] = [];
      const tags: string[] = [];
      let desc = rest;

      // 提取所有 wikilink（格式：[[...]]）
      const linkRegex = /\[\[[^\]]+\]\]/g;
      let m;
      while ((m = linkRegex.exec(desc)) !== null) {
        wikilinks.push(m[0]);
      }
      desc = desc.replace(linkRegex, "").trim();

      // 提取所有标签（格式：#tag-name）
      const tagRegex = /#[\w-]+/g;
      while ((m = tagRegex.exec(desc)) !== null) {
        tags.push(m[0]);
      }
      desc = desc.replace(tagRegex, "").trim();

      events.push({ time, icon, description: desc, links: wikilinks, tags });
    }
  }

  return events;
}

// ── 任务链接管理（操作 Task.md 的 frontmatter） ──────────────────────────

/**
 * 更新任务文件 frontmatter 中的日记生命周期链接
 *
 * @param taskFilePath  任务文件的绝对路径
 * @param field         要更新的字段名：
 *                        - "created_log":   创建日志链接
 *                        - "completed_log": 完成日志链接
 *                        - "blocked_log":   阻塞日志链接
 * @param date          关联的日期
 * @param vaultRoot     Obsidian vault 根目录
 *
 * 副作用：
 *   - 写入 [field] 字段（wikilink 格式指向日记）
 *   - 写入对应的 [field_at] 字段（日期字符串）
 *   例如：field="created_log" 会同时设置 created_log 和 created_at
 *
 * 设计意图：任务文件通过这些字段知道它在哪些日期发生了状态变更，
 * 从而实现从任务到日记的"反向链接"。
 */
export function updateTaskDiaryLink(
  taskFilePath: string,
  field: "created_log" | "completed_log" | "blocked_log",
  date: Date,
  vaultRoot: string
): void {
  if (!fs.existsSync(taskFilePath)) {
    throw new Error(`Task file not found: ${taskFilePath}`);
  }

  const raw = fs.readFileSync(taskFilePath, "utf-8");
  const parsed = matter(raw);
  const dateStr = formatDate(date);

  // 获取日记文件的相对路径，转换为 wikilink
  const diaryPath = getDiaryPath(vaultRoot, date);
  const diaryRel = relativeToVault(vaultRoot, diaryPath);
  const diaryLink = toWikilink(diaryRel);

  // 同时设置对应的日期字段：created_log → created_at
  const dateField = field.replace("_log", "_at");

  parsed.data[field] = diaryLink;
  parsed.data[dateField] = dateStr;

  // 序列化并写回文件
  const newContent = matter.stringify(parsed.content, parsed.data);
  fs.writeFileSync(taskFilePath, newContent, "utf-8");
}

/**
 * 移除任务文件 frontmatter 中的阻塞相关字段
 *
 * @param taskFilePath  任务文件的绝对路径
 *
 * 移除的字段：
 *   - blocked_at:   阻塞发生的时间
 *   - blocked_log:  阻塞日志的 wikilink
 *
 * 使用场景：unblock 命令解除任务阻塞时调用。
 */
export function removeTaskBlockedFields(taskFilePath: string): void {
  if (!fs.existsSync(taskFilePath)) {
    throw new Error(`Task file not found: ${taskFilePath}`);
  }

  const raw = fs.readFileSync(taskFilePath, "utf-8");
  const parsed = matter(raw);

  delete parsed.data.blocked_at;
  delete parsed.data.blocked_log;

  const newContent = matter.stringify(parsed.content, parsed.data);
  fs.writeFileSync(taskFilePath, newContent, "utf-8");
}
