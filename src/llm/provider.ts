/**
 * @file LLM 提供商抽象接口 (LLM Provider Abstraction)
 *
 * 定义 LLM 提供商的统一接口和辅助工具。
 * 所有 LLM 提供商（APIProvider、PipeProvider）都实现此接口。
 *
 * 两种模式：
 *   1. api  — CLI 直接调用 LLM API（静默模式，适合自动化）
 *   2. pipe — CLI 通过 stdout 输出 prompt，从 stdin 读取响应
 *             （设计用于 Helios：AI 代理在对话中推理，实现完全可视化）
 *
 * 模块关系：
 *   provider.ts (接口) ← api-provider.ts (API 实现)
 *                      ← pipe-provider.ts (管道实现)
 *                      ← factory.ts (工厂创建)
 */

/**
 * LLM 响应接口 —— 统一的 LLM 响应格式
 *
 * @property content   LLM 生成的文本内容
 * @property usage     可选的 token 使用量统计
 * @property usage.prompt       输入（prompt）消耗的 token 数
 * @property usage.completion   输出（completion）消耗的 token 数
 */
export interface LLMResponse {
  content: string;
  usage?: { prompt: number; completion: number };
}

/**
 * LLM 提供商接口 —— 所有 LLM 实现必须遵循的契约
 *
 * @property name              提供商名称标识（如 "api", "pipe"）
 * @method   complete          发送 prompt 并获取响应
 * @method   isInteractive     是否需要人工交互
 *
 * 实现类：
 *   - APIProvider（api-provider.ts）：直接调用 Anthropic/OpenAI API
 *   - PipeProvider（pipe-provider.ts）：通过 stdin/stdout 与 AI 代理交互
 */
export interface LLMProvider {
  /** 提供商名称标识 */
  name: string;

  /**
   * 发送 prompt 并获取 LLM 响应
   *
   * @param prompt  用户 prompt 文本
   * @param system  可选的系统 prompt（设定 AI 的角色和行为）
   * @returns {Promise<LLMResponse>} LLM 的响应
   */
  complete(prompt: string, system?: string): Promise<LLMResponse>;

  /**
   * 是否需要人工交互
   *
   * @returns {boolean}
   *   - true:  PipeProvider 模式，需要外部 AI 代理参与
   *   - false: APIProvider 模式，直接 API 调用
   */
  isInteractive(): boolean;
}

/**
 * 从 LLM 响应文本中解析 JSON
 *
 * @param text  LLM 返回的原始文本
 * @returns {T} 解析后的 JSON 对象
 * @throws {Error} 无法解析 JSON 时抛出错误
 *
 * 处理策略（按优先级）：
 *   1. 去除 markdown 代码块包裹（```json ... ```）
 *   2. 直接 JSON.parse
 *   3. 尝试从文本中提取 JSON 对象/数组（正则匹配 [...] 或 {...}）
 *
 * 设计意图：LLM 经常在 JSON 周围添加 markdown 代码块或解释文本，
 * 此函数能智能地从中提取有效的 JSON 数据。
 */
export function parseJSON<T = any>(text: string): T {
  // 去除首尾空白
  let cleaned = text.trim();
  // 提取 markdown 代码块中的内容
  const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) cleaned = m[1].trim();

  // 尝试直接解析
  try { return JSON.parse(cleaned); } catch {}

  // 尝试从文本中提取 JSON 对象或数组
  const objMatch = cleaned.match(/[\[{][\s\S]*[\]]/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  throw new Error(`Failed to parse JSON from LLM response:\n${text.slice(0, 500)}`);
}
