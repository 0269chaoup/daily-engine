import { Command } from "commander";
import fs from "fs";

// ── CLI Context ────────────────────────────────────────────────────────────

export interface CLIContext {
  vault: { root: string };
  verbose: boolean;
}

export function buildContext(opts: any): CLIContext {
  const vaultRoot: string =
    opts.vault ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(`Vault not found: ${vaultRoot}`);
  }
  return { vault: { root: vaultRoot }, verbose: opts.verbose ?? false };
}

// ── Table Helpers ──────────────────────────────────────────────────────────

export function row(label: string, value: string | number, icon?: string): void {
  const prefix = icon ? `${icon} ` : "  ";
  console.log(`  ${prefix}${label.padEnd(24)} ${value}`);
}

export function section(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(50));
}
