/**
 * @file LLM 工厂模块 (LLM Factory)
 *
 * 根据 CLI 选项创建对应的 LLM 提供商实例。
 * 支持两种模式：
 *   - "api":   APIProvider —— 直接调用 API，静默模式
 *   - "agent": PipeProvider —— 通过 stdin/stdout 与 AI 代理交互
 *
 * 依赖：
 *   - llm/provider.ts     → LLMProvider (接口)
 *   - llm/api-provider.ts → APIProvider (API 实现)
 *   - llm/pipe-provider.ts → PipeProvider (管道实现)
 */

import type { LLMProvider } from "./provider.js";
import { APIProvider } from "./api-provider.js";
import { PipeProvider } from "./pipe-provider.js";

/**
 * LLM 选项接口 —— 从 CLI 选项传入的 LLM 配置
 *
 * @property provider      提供商类型："api"（直接 API 调用）或 "agent"（AI 代理模式）
 * @property apiProvider    API 提供商名称："anthropic" 或 "openai"（仅 api 模式有效）
 * @property model          模型名称（仅 api 模式有效）
 * @property apiKey         API 密钥（仅 api 模式有效）
 * @property baseUrl        自定义 API 基础 URL（仅 api 模式有效）
 */
export interface LLMOptions {
  provider: "api" | "agent";
  apiProvider?: "anthropic" | "openai";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * LLM 提供商工厂函数 —— 根据选项创建 LLM 实例
 *
 * @param opts  LLM 配置选项
 * @returns {LLMProvider | null} LLM 提供商实例，创建失败返回 null
 *
 * 模式说明：
 *   --llm api    → APIProvider: 静默直接调用 API（适合自动化）
 *   --llm agent  → PipeProvider: Helios 读取 prompt，在对话中推理，写回结果
 *
 * 设计决策：
 *   返回 null 而不是抛出错误，使得不需要 LLM 的命令（如 init、task）
 *   在 LLM 配置不完整时仍能正常运行。
 */
export function createLLM(opts: LLMOptions): LLMProvider | null {
  // agent 模式：创建 PipeProvider，不需要 API 密钥
  if (opts.provider === "agent") {
    return new PipeProvider();
  }
  // api 模式：创建 APIProvider，可能因缺少 API 密钥而失败
  try {
    return new APIProvider({
      provider: opts.apiProvider ?? "anthropic",
      model: opts.model ?? "claude-sonnet-4-6",
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
    });
  } catch {
    // 创建失败（如无 API 密钥），返回 null
    return null;
  }
}
