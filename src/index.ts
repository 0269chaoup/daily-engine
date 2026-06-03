#!/usr/bin/env node
/**
 * @file 入口文件 (Entry Point)
 *
 * daily-engine CLI 的主入口，使用 commander 库构建命令行界面。
 * 该文件负责：
 *   1. 定义全局选项（vault路径、LLM提供商、模型、API密钥等）
 *   2. 注册所有子命令（init, task, log, complete, block, unblock, today, week-review, link）
 *   3. 解析命令行参数并执行对应命令
 *
 * 全局选项说明：
 *   --vault        Obsidian vault 根目录路径，默认从环境变量 OBSIDIAN_VAULT 或当前工作目录获取
 *   --llm          LLM 提供商类型，'agent' 表示通过 PipeProvider 与 AI 代理交互，'api' 表示直接调用 API
 *   --api-provider 具体的 API 提供商，支持 'anthropic' 和 'openai'
 *   --model        LLM 模型名称
 *   --api-key      API 密钥，也可通过环境变量 ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY 设置
 *   --base-url     自定义 API 基础 URL（用于代理）
 *   --verbose      是否输出详细日志
 *
 * 子命令来源：
 *   - commands/init.ts        → init:       初始化今日日记
 *   - commands/task.ts        → task:       创建新任务
 *   - commands/log.ts         → log:        追加日志条目
 *   - commands/complete.ts    → complete:   标记任务完成
 *   - commands/complete.ts    → block:      标记任务阻塞
 *   - commands/complete.ts    → unblock:    解除任务阻塞
 *   - commands/today.ts       → today:      显示今日概览
 *   - commands/week-review.ts → week-review:生成周复盘报告
 *   - commands/link.ts        → link:       校验双向链接完整性
 */

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { taskCommand } from "./commands/task.js";
import { logCommand } from "./commands/log.js";
import { completeCommand, blockCommand, unblockCommand } from "./commands/complete.js";
import { todayCommand } from "./commands/today.js";
import { weekReviewCommand } from "./commands/week-review.js";
import { linkCommand } from "./commands/link.js";

/** 创建 CLI 程序实例 */
const program = new Command();

/** 配置 CLI 程序的基本信息、描述和版本号 */
program
  .name("daily-engine")
  .description(
    "Daily journal orchestration engine for Obsidian — event-sourced diary with Work/ dual-linking"
  )
  .version("1.0.0")
  .option("--vault <path>", "vault root directory", process.env.OBSIDIAN_VAULT ?? process.cwd())
  .option("--llm <provider>", "LLM provider: agent | api", "agent")
  .option("--api-provider <name>", "API provider: anthropic | openai", "anthropic")
  .option("--model <name>", "LLM model name", "claude-sonnet-4-6")
  .option("--api-key <key>", "API key (or set ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY)")
  .option("--base-url <url>", "Custom API base URL (for proxies)")
  .option("--verbose", "verbose output", false);

// 注册所有子命令到主程序
// 每个命令工厂函数返回一个 Command 实例，包含自身的选项和 action 处理逻辑
program.addCommand(initCommand());
program.addCommand(taskCommand());
program.addCommand(logCommand());
program.addCommand(completeCommand());
program.addCommand(blockCommand());
program.addCommand(unblockCommand());
program.addCommand(todayCommand());
program.addCommand(weekReviewCommand());
program.addCommand(linkCommand());

/** 解析命令行参数，匹配子命令并执行 */
program.parse();
