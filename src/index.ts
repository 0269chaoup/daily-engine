#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { taskCommand } from "./commands/task.js";
import { logCommand } from "./commands/log.js";
import { completeCommand, blockCommand, unblockCommand } from "./commands/complete.js";
import { todayCommand } from "./commands/today.js";
import { weekReviewCommand } from "./commands/week-review.js";
import { linkCommand } from "./commands/link.js";

const program = new Command();

program
  .name("daily-engine")
  .description(
    "Daily journal orchestration engine for Obsidian — event-sourced diary with Work/ dual-linking"
  )
  .version("1.0.0")
  .option(
    "--vault <path>",
    "vault root directory",
    process.env.OBSIDIAN_VAULT ?? process.cwd()
  )
  .option("--verbose", "verbose output", false);

// Register commands
program.addCommand(initCommand());
program.addCommand(taskCommand());
program.addCommand(logCommand());
program.addCommand(completeCommand());
program.addCommand(blockCommand());
program.addCommand(unblockCommand());
program.addCommand(todayCommand());
program.addCommand(weekReviewCommand());
program.addCommand(linkCommand());

program.parse();
