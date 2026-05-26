import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { WORK_DIR, relativeToVault, toWikilink } from "./path-utils.js";

// ── Interfaces ─────────────────────────────────────────────────────────────

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

// ── Work-Engine Bridge ─────────────────────────────────────────────────────

/**
 * Create a task via work-engine CLI, then return the task info.
 */
export function createTaskViaEngine(
  vaultRoot: string,
  project: string,
  title: string,
  options?: { type?: string; status?: string; group?: string[] }
): TaskInfo {
  // Call work-engine work task create
  const args = [
    "work-engine",
    "work",
    "task",
    "create",
    shellQuote(project),
    shellQuote(title),
  ];

  if (options?.group) {
    for (const g of options.group) {
      args.push("--group", shellQuote(g));
    }
  }

  const cmd = `OBSIDIAN_VAULT=${shellQuote(vaultRoot)} ${args.join(" ")}`;

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Parse output to get file path
    const match = output.match(/Created (?:task note|work note): (.+\.md)/);
    if (match) {
      const absPath = path.resolve(vaultRoot, match[1]);
      return buildTaskInfo(vaultRoot, absPath, project, title);
    }
  } catch (err: any) {
    // If work-engine not found, create directly
    if (err.code === "ENOENT" || err.status === 127) {
      console.warn("⚠️  work-engine not found, creating task file directly");
      return createTaskDirectly(vaultRoot, project, title);
    }
    // If file already exists, find it
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
 * Find a task file in Work/ by fuzzy matching title.
 */
export function findTaskFile(
  vaultRoot: string,
  project: string,
  title: string
): string | null {
  const workDir = path.join(vaultRoot, WORK_DIR, project);
  if (!fs.existsSync(workDir)) return null;

  // Try exact match first
  const sanitized = sanitizeFilename(title);
  const exactPath = path.join(workDir, `${sanitized}.md`);
  if (fs.existsSync(exactPath)) return exactPath;

  // Fuzzy search: look for files containing the title words
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
 * Find a task file across all projects by title.
 */
export function findTaskFileGlobal(
  vaultRoot: string,
  title: string
): TaskInfo | null {
  const workRoot = path.join(vaultRoot, WORK_DIR);
  if (!fs.existsSync(workRoot)) return null;

  const projects = fs.readdirSync(workRoot).filter(d => {
    const full = path.join(workRoot, d);
    return fs.statSync(full).isDirectory();
  });

  for (const project of projects) {
    const absPath = findTaskFile(vaultRoot, project, title);
    if (absPath) {
      return buildTaskInfo(vaultRoot, absPath, project, title);
    }
  }

  return null;
}

/**
 * Read task info from an existing file.
 */
export function readTaskInfo(vaultRoot: string, absPath: string): TaskInfo | null {
  if (!fs.existsSync(absPath)) return null;

  const raw = fs.readFileSync(absPath, "utf-8");
  const parsed = matter(raw);
  const relPath = relativeToVault(vaultRoot, absPath);
  const parts = relPath.split("/");
  // Extract project from path: 30-Projects/Work/<project>/file.md
  const project = parts.length >= 4 ? parts[2] : "General";
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

// ── Internal Helpers ───────────────────────────────────────────────────────

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

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
