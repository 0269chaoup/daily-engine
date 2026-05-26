import fs from "fs";
import path from "path";

// ── Constants ──────────────────────────────────────────────────────────────

export const DAILY_DIR = "20-Daily";
export const WORK_DIR = "30-Projects/Work";

// ── ISO Week Number ────────────────────────────────────────────────────────

/** Get ISO week number (1-53) and ISO week-year for a date */
export function getISOWeek(date: Date): { weekYear: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday (0) → 7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const weekYear = d.getUTCFullYear();
  // Jan 1 of weekYear
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  // Week number = ceil((d - yearStart) / 7 days) + 1
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekYear, week };
}

// ── Path Generation ────────────────────────────────────────────────────────

/**
 * Generate diary file path for a given date.
 * Structure: 20-Daily/YYYY/MM/第NN周/YYYY-MM-DD.md
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
 * Generate week review file path.
 * Structure: 20-Daily/YYYY/MM/第NN周/YYYY-WNN_周复盘.md
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
 * Generate month view path.
 * Structure: 20-Daily/YYYY/MM/YYYY-MM_月视图.md
 */
export function getMonthViewPath(vaultRoot: string, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dateStr = `${year}-${month}`;

  return path.join(vaultRoot, DAILY_DIR, String(year), month, `${dateStr}_月视图.md`);
}

/** Format date as YYYY-MM-DD */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format time as HH:MM */
export function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Get relative path from vault root */
export function relativeToVault(vaultRoot: string, absPath: string): string {
  return path.relative(vaultRoot, absPath).replace(/\\/g, "/");
}

/** Get wikilink path (without .md extension, with optional alias) */
export function toWikilink(relativePath: string, alias?: string): string {
  const noExt = relativePath.replace(/\.md$/, "");
  return alias ? `[[${noExt}|${alias}]]` : `[[${noExt}]]`;
}

/** Ensure parent directory exists */
export function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
