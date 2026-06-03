/**
 * @file CLI 工具库 (CLI Utilities)
 *
 * 提供 CLI 上下文构建和终端输出格式化功能。
 * 所有命令都依赖此模块来：
 *   1. 构建 CLIContext —— 包含 vault 路径、LLM 实例、verbose 标志
 *   2. 格式化表格输出 —— row() 和 section() 用于美化控制台输出
 *
 * 依赖：
 *   - llm/factory.ts  → createLLM (LLM 提供商工厂)
 *   - llm/provider.ts → LLMProvider (LLM 提供商接口)
 */

import { Command } from "commander";
import fs from "fs";
import { createLLM } from "../llm/factory.js";
import type { LLMOptions } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";

// ── CLI 上下文 ────────────────────────────────────────────────────────────

/**
 * CLI 上下文接口 —— 每个命令执行时的共享配置
 *
 * @property vault    Obsidian vault 信息
 * @property vault.root  vault 根目录的绝对路径
 * @property llm      LLM 提供商实例（可能为 null，表示不需要 LLM 或创建失败）
 * @property verbose  是否输出详细日志
 *
 * 设计意图：通过 buildContext() 从命令行选项构建，传递给所有需要
 * vault 路径和 LLM 能力的子命令。
 */
export interface CLIContext {
  vault: { root: string };
  llm: LLMProvider | null;
  verbose: boolean;
}

/**
 * 构建 CLI 上下文
 *
 * @param opts  命令行选项对象（来自 commander 的 parent.opts()）
 * @returns {CLIContext} 构建好的 CLI 上下文
 * @throws {Error} 如果 vault 目录不存在
 *
 * 处理流程：
 *   1. 确定 vault 根目录（优先级：--vault 选项 > OBSIDIAN_VAULT 环境变量 > 当前工作目录）
 *   2. 验证 vault 目录存在
 *   3. 构建 LLM 选项并创建 LLM 提供商实例
 *   4. 返回包含所有配置的上下文对象
 */
export function buildContext(opts: any): CLIContext {
  // 按优先级确定 vault 路径
  const vaultRoot: string =
    opts.vault ?? process.env.OBSIDIAN_VAULT ?? process.cwd();
  if (!fs.existsSync(vaultRoot)) {
    throw new Error(`Vault not found: ${vaultRoot}`);
  }

  // 构建 LLM 配置选项
  const llmOpts: LLMOptions = {
    provider: opts.llm ?? "agent",
    apiProvider: opts.apiProvider ?? "anthropic",
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  };
  // 创建 LLM 实例（可能返回 null，如无 API 密钥）
  const llm = createLLM(llmOpts);
  return { vault: { root: vaultRoot }, llm, verbose: opts.verbose ?? false };
}

/**
 * 要求 LLM 可用 —— 如果 LLM 不可用则抛出错误
 *
 * @param ctx  CLI 上下文
 * @returns {LLMProvider} 可用的 LLM 提供商实例
 * @throws {Error} 如果 LLM 不可用
 *
 * 使用场景：需要 LLM 能力的命令（如 week-review 的智能总结）
 * 在执行前调用此函数确保 LLM 已配置。
 */
export function requireLLM(ctx: CLIContext): LLMProvider {
  if (!ctx.llm) {
    throw new Error("This command requires an LLM provider. Set ANTHROPIC_AUTH_TOKEN or use --llm agent");
  }
  return ctx.llm;
}

// ── 表格输出辅助 ──────────────────────────────────────────────────────────

/**
 * 输出一行格式化的键值对
 *
 * @param label  标签名（左对齐，填充到 24 字符）
 * @param value  值（可以是字符串或数字）
 * @param icon   可选的图标前缀（emoji）
 *
 * 输出格式示例：  📄 Task                    path/to/file.md
 */
export function row(label: string, value: string | number, icon?: string): void {
  const prefix = icon ? `${icon} ` : "  ";
  console.log(`  ${prefix}${label.padEnd(24)} ${value}`);
}

/**
 * 输出一个带分隔线的章节标题
 *
 * @param title  章节标题文本
 *
 * 输出格式示例：
 *   ① Creating task
 *   ──────────────────────────────────────────────────
 */
export function section(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(50));
}
