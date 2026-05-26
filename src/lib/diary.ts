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

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface DiaryFrontmatter {
  date: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface DiaryEvent {
  time: string;       // HH:MM
  icon: string;       // 🆕 ✅ 📝 🚧 🔓 etc.
  description: string;
  links: string[];    // wikilinks
  tags: string[];     // #task-created etc.
}

export interface DiaryFile {
  absPath: string;
  relPath: string;
  frontmatter: DiaryFrontmatter;
  body: string;
  events: DiaryEvent[];
}

// ── Event Icons ────────────────────────────────────────────────────────────

export const EVENT_ICONS = {
  created: "🆕",
  completed: "✅",
  log: "📝",
  blocked: "🚧",
  unblocked: "🔓",
  insight: "💡",
  note: "📌",
} as const;

// ── Read / Write ───────────────────────────────────────────────────────────

/** Read an existing diary file */
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

/** Create a new diary file with standard template */
export function createDiary(vaultRoot: string, date: Date): DiaryFile {
  const absPath = getDiaryPath(vaultRoot, date);
  ensureDir(absPath);

  const dateStr = formatDate(date);
  const { weekYear, week } = getISOWeek(date);
  const weekStr = String(week).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");

  // Navigation links
  const yearView = `[[${date.getFullYear()}_年视图]]`;
  const monthView = `[[${date.getFullYear()}-${month}_月视图]]`;
  const weekReview = `[[${weekYear}-W${weekStr}_周复盘]]`;

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

/** Ensure diary exists (read or create) */
export function ensureDiary(vaultRoot: string, date: Date): DiaryFile {
  return readDiary(vaultRoot, date) ?? createDiary(vaultRoot, date);
}

// ── Event Appending ────────────────────────────────────────────────────────

/** Append an event to the 日志 section of a diary file */
export function appendEvent(
  vaultRoot: string,
  date: Date,
  event: DiaryEvent
): void {
  const diary = ensureDiary(vaultRoot, date);
  const eventLine = formatEventLine(event);

  // Find the ## 日志 section and append
  const raw = fs.readFileSync(diary.absPath, "utf-8");
  const lines = raw.split("\n");

  // Find "## 日志" line
  let logSectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## 日志") {
      logSectionIdx = i;
      break;
    }
  }

  if (logSectionIdx === -1) {
    // No 日志 section found, append one
    lines.push("", "## 日志", eventLine);
  } else {
    // Find the end of 日志 section (next ## heading or end of file)
    let insertIdx = logSectionIdx + 1;
    while (insertIdx < lines.length) {
      const line = lines[insertIdx].trim();
      // Skip empty lines and blockquote descriptions right after the heading
      if (line === "" || line.startsWith("> ")) {
        insertIdx++;
        continue;
      }
      break;
    }

    // Now scan to find the actual end of content in 日志 section
    let endIdx = insertIdx;
    while (endIdx < lines.length) {
      const line = lines[endIdx].trim();
      if (line.startsWith("## ") && endIdx > logSectionIdx) {
        break; // Next section
      }
      endIdx++;
    }

    // Insert before the next section (or at end)
    lines.splice(endIdx, 0, eventLine);
  }

  fs.writeFileSync(diary.absPath, lines.join("\n"), "utf-8");
}

/** Format an event into a diary line */
export function formatEventLine(event: DiaryEvent): string {
  const linksStr = event.links.length > 0 ? " " + event.links.join(" ") : "";
  const tagsStr = event.tags.length > 0 ? " " + event.tags.join(" ") : "";
  return `- \`${event.time}\` ${event.icon} ${event.description}${linksStr}${tagsStr}`;
}

/** Parse events from diary body (lines starting with - `HH:MM`) */
function parseEvents(body: string): DiaryEvent[] {
  const events: DiaryEvent[] = [];
  const lines = body.split("\n");

  for (const line of lines) {
    const match = line.match(
      /^- `(\d{2}:\d{2})`\s+(🆕|✅|📝|🚧|🔓|💡|📌)\s+(.+)/
    );
    if (match) {
      const [, time, icon, rest] = match;
      // Extract wikilinks and tags from the rest
      const wikilinks: string[] = [];
      const tags: string[] = [];
      let desc = rest;

      // Extract wikilinks
      const linkRegex = /\[\[[^\]]+\]\]/g;
      let m;
      while ((m = linkRegex.exec(desc)) !== null) {
        wikilinks.push(m[0]);
      }
      desc = desc.replace(linkRegex, "").trim();

      // Extract tags
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

// ── Task Link Management (Task.md frontmatter) ─────────────────────────────

/**
 * Update a Task.md's frontmatter with diary lifecycle links.
 * This writes to the Task file, NOT the diary.
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

  // Get the diary relative path for wikilink
  const diaryPath = getDiaryPath(vaultRoot, date);
  const diaryRel = relativeToVault(vaultRoot, diaryPath);
  const diaryLink = toWikilink(diaryRel);

  // Also set the corresponding date field
  const dateField = field.replace("_log", "_at");

  parsed.data[field] = diaryLink;
  parsed.data[dateField] = dateStr;

  // Serialize back
  const newContent = matter.stringify(parsed.content, parsed.data);
  fs.writeFileSync(taskFilePath, newContent, "utf-8");
}

/**
 * Remove blocked_at and blocked_log from task frontmatter (unblock).
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
