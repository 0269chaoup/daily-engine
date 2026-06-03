/**
 * @file 管道提供商 (Pipe Provider) — "Helios 模式"
 *
 * 通过 stdin/stdout 管道与外部 AI 代理（Helios）交互的 LLM 提供商。
 * 不直接调用 API，而是将 prompt 输出到 stdout，从 stdin 读取响应。
 *
 * 工作流程（"Helios 模式"）：
 *   1. CLI 将 prompt 以 JSON 格式写入 stdout
 *   2. 外部 AI 代理（Helios）从 stdout 读取 prompt
 *   3. Helios 在对话中进行推理（用户可见 = 可视化！）
 *   4. Helios 将结果以 JSON 格式写入 stdin
 *   5. CLI 读取响应并继续执行
 *
 * 通信协议（JSON lines）：
 *   CLI → stdout: {"type":"prompt","id":"...","prompt":"...","system":"..."}
 *   CLI ← stdin:  {"type":"response","id":"...","content":"..."}
 *
 * 对比 APIProvider：
 *   - APIProvider: CLI → API → 结果（静默，适合自动化）
 *   - PipeProvider: CLI ↔ AI Agent（可视化，用户可参与推理过程）
 *
 * 依赖：
 *   - readline          → 逐行读取 stdin
 *   - llm/provider.ts   → LLMProvider, LLMResponse (接口定义)
 */

import * as readline from "readline";
import type { LLMProvider, LLMResponse } from "./provider.js";

/**
 * 管道提供商类 —— 通过 stdin/stdout 与 AI 代理交互
 *
 * 实现了 LLMProvider 接口，使用异步消息传递模式。
 * 内部维护一个待响应 Map，通过消息 ID 匹配请求和响应。
 */
export class PipeProvider implements LLMProvider {
  /** 提供商名称标识 */
  name = "pipe";

  /**
   * 待响应映射表 —— 存储等待响应的 Promise resolve 函数
   * key: 消息 ID（如 "p1", "p2"）
   * value: 对应 Promise 的 resolve 函数
   */
  private pendingResolves = new Map<string, (value: string) => void>();

  /** readline 接口，用于逐行读取 stdin */
  private rl: readline.Interface;

  /** prompt 计数器，用于生成唯一的消息 ID */
  private promptCounter = 0;

  /**
   * 构造函数 —— 初始化 stdin 读取和消息处理
   *
   * 设置 readline 接口监听 stdin 输入，
   * 当收到 JSON 格式的 response 消息时，
   * 通过 pendingResolves Map 找到对应的 Promise 并 resolve。
   */
  constructor() {
    // 创建 readline 接口，从 stdin 逐行读取（非终端模式）
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        // 如果是 response 类型的消息且有待处理的请求
        if (msg.type === "response" && msg.id && this.pendingResolves.has(msg.id)) {
          // resolve 对应的 Promise
          this.pendingResolves.get(msg.id)!(msg.content);
          this.pendingResolves.delete(msg.id);
        }
      } catch { /* 忽略无法解析的行 */ }
    });
  }

  /**
   * Pipe 模式是交互式的（需要外部 AI 代理参与）
   * @returns {boolean} 始终返回 true
   */
  isInteractive() { return true; }

  /**
   * 发送 prompt 并等待响应
   *
   * @param prompt  用户 prompt 文本
   * @param system  可选的系统 prompt
   * @returns {Promise<LLMResponse>} LLM 响应对象
   * @throws {Error} 超时（5 分钟）后抛出错误
   *
   * 流程：
   *   1. 生成唯一的消息 ID
   *   2. 将 prompt 以 JSON 格式写入 stdout
   *   3. 创建 Promise 等待对应的 response
   *   4. 当 stdin 收到匹配 ID 的 response 时 resolve
   *   5. 超时时间：5 分钟（300,000ms）
   */
  async complete(prompt: string, system?: string): Promise<LLMResponse> {
    // 生成递增的唯一消息 ID
    const id = `p${++this.promptCounter}`;

    // 将 prompt 以 JSON line 格式写入 stdout，供 AI 代理读取
    const msg = JSON.stringify({ type: "prompt", id, prompt, system });
    process.stdout.write(msg + "\n");

    // 创建 Promise 等待响应
    return new Promise((resolve, reject) => {
      // 设置 5 分钟超时
      const timer = setTimeout(() => {
        this.pendingResolves.delete(id);
        reject(new Error(`Pipe timeout waiting for response (id=${id}). Is Helios listening?`));
      }, 300_000); // 5 min timeout

      // 注册到待响应 Map
      this.pendingResolves.set(id, (content) => {
        clearTimeout(timer);
        resolve({ content });
      });
    });
  }

  /**
   * 关闭管道 —— 释放 readline 接口资源
   *
   * 应在程序结束前调用，确保 stdin 被正确关闭。
   */
  close() {
    this.rl.close();
  }
}
