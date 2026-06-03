/**
 * @file API 提供商 (API Provider)
 *
 * 直接调用 LLM API 的提供商实现。
 * 支持 Anthropic（Claude）和 OpenAI（GPT）两种 API。
 *
 * 这是 LLM 模块中的"静默模式"——CLI 直接调用 API 获取结果，
 * 不需要人工交互，适合自动化场景。
 *
 * 对比 PipeProvider（"Helios 模式"）：
 *   - APIProvider: CLI → API → 结果（静默，无人参与）
 *   - PipeProvider: CLI → stdout → AI Agent → stdin → 结果（可视化，有人参与）
 *
 * 依赖：
 *   - llm/provider.ts → LLMProvider, LLMResponse (接口定义)
 */

import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * API 配置接口
 *
 * @property provider   API 提供商类型："anthropic" 或 "openai"
 * @property apiKey     API 密钥
 * @property model      模型名称
 * @property baseUrl    可选的自定义 API 基础 URL（用于代理或私有部署）
 */
interface APIConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/**
 * API 提供商类 —— 直接调用 LLM API
 *
 * 实现了 LLMProvider 接口，支持 Anthropic 和 OpenAI 两种 API。
 * 对外暴露 complete() 方法发送 prompt 并获取响应。
 */
export class APIProvider implements LLMProvider {
  /** 提供商名称标识 */
  name = "api";
  /** API 配置 */
  private config: APIConfig;

  /**
   * 构造函数
   *
   * @param config  可选的 API 配置，未提供的字段使用默认值
   * @throws {Error} 如果未找到 API 密钥
   *
   * API 密钥查找优先级：
   *   1. config.apiKey 参数
   *   2. ANTHROPIC_AUTH_TOKEN 环境变量
   *   3. OPENAI_API_KEY 环境变量
   */
  constructor(config?: Partial<APIConfig>) {
    this.config = {
      provider: config?.provider ?? "anthropic",
      apiKey: config?.apiKey ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.OPENAI_API_KEY ?? "",
      model: config?.model ?? "claude-sonnet-4-6",
      baseUrl: config?.baseUrl,
    };
    if (!this.config.apiKey) {
      throw new Error("No API key found. Set ANTHROPIC_AUTH_TOKEN or OPENAI_API_KEY env var.");
    }
  }

  /**
   * API 模式不是交互式的（直接调用 API，不需要人工参与）
   * @returns {boolean} 始终返回 false
   */
  isInteractive() { return false; }

  /**
   * 发送 prompt 并获取 LLM 响应
   *
   * @param prompt  用户 prompt 文本
   * @param system  可选的系统 prompt
   * @returns {Promise<LLMResponse>} LLM 响应对象
   *
   * 根据配置的 provider 类型自动选择 Anthropic 或 OpenAI API。
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    if (this.config.provider === "anthropic") {
      return this.callAnthropic(prompt, system);
    }
    return this.callOpenAI(prompt, system);
  }

  /**
   * 调用 Anthropic Messages API
   *
   * @param prompt  用户 prompt
   * @param system  系统 prompt
   * @returns {Promise<LLMResponse>} LLM 响应
   * @throws {Error} API 返回错误时抛出
   *
   * API 端点：{baseUrl}/v1/messages
   * 认证方式：x-api-key header
   * 默认最大 token：4096
   */
  private async callAnthropic(prompt: string, system?: string): Promise<LLMResponse> {
    const url = this.config.baseUrl ?? "https://api.anthropic.com";
    const resp = await fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        system: system ?? "You are a knowledge analysis engine. Always respond in valid JSON when asked.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await resp.json() as any;
    if (data.error) throw new Error(`Anthropic API error: ${data.error.message}`);
    return {
      content: data.content?.[0]?.text ?? "",
      usage: data.usage ? { prompt: data.usage.input_tokens, completion: data.usage.output_tokens } : undefined,
    };
  }

  /**
   * 调用 OpenAI Chat Completions API
   *
   * @param prompt  用户 prompt
   * @param system  系统 prompt
   * @returns {Promise<LLMResponse>} LLM 响应
   * @throws {Error} API 返回错误时抛出
   *
   * API 端点：{baseUrl}/v1/chat/completions
   * 认证方式：Bearer token (Authorization header)
   * 默认最大 token：4096
   */
  private async callOpenAI(prompt: string, system?: string): Promise<LLMResponse> {
    const url = this.config.baseUrl ?? "https://api.openai.com";
    const resp = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: system ?? "You are a knowledge analysis engine. Always respond in valid JSON when asked." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await resp.json() as any;
    if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`);
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : undefined,
    };
  }
}
