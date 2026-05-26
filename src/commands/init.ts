import { Command } from "commander";
import { buildContext, row, section } from "../lib/cli-utils.js";
import { ensureDiary } from "../lib/diary.js";
import { formatDate, getDiaryPath, getISOWeek, relativeToVault } from "../lib/path-utils.js";

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize today's diary (create if not exists)")
    .option("--date <date>", "Date to initialize (YYYY-MM-DD), default: today")
    .action((opts, cmd) => {
      const ctx = buildContext(cmd.parent?.opts() ?? {});
      const date = opts.date ? new Date(opts.date + "T00:00:00") : new Date();
      const diary = ensureDiary(ctx.vault.root, date);
      const relPath = relativeToVault(ctx.vault.root, diary.absPath);
      const { weekYear, week } = getISOWeek(date);

      console.log(`\n📅 Diary initialized`);
      row("Date", formatDate(date), "📆");
      row("Week", `W${week} (${weekYear})`, "📋");
      row("Path", relPath, "📄");
      row("Events", String(diary.events.length), "📝");
      console.log();
    });
}
