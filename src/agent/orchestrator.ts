/**
 * Agent 編排器：協調 LLM 和工具執行的完整循環
 */

import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client";
import { ToolRegistry } from "../tools/registry";
import { ToolExecutor } from "../tools/executor";
import { parseToolCalls, formatToolResult } from "../tools/parser";
import { ToolExecutionContext, ToolDefinition } from "../tools/types";

export interface OrchestratorOptions {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  executionContext: ToolExecutionContext;
  maxIterations?: number;
  verbose?: boolean;
}

export interface OrchestratorResult {
  success: boolean;
  finalResponse: string;
  iterations: number;
  toolCallsExecuted: number;
  error?: string;
}

export class AgentOrchestrator {
  private llmClient: LLMClient;
  private toolExecutor: ToolExecutor;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private verbose: boolean;

  constructor(options: OrchestratorOptions) {
    this.llmClient = options.llmClient;
    this.toolRegistry = options.toolRegistry;
    this.toolExecutor = new ToolExecutor(options.toolRegistry, options.executionContext);
    this.maxIterations = options.maxIterations || 10;
    this.verbose = options.verbose || false;
  }

  /**
   * 執行完整的 Agent 循環
   * @param initialMessages 初始對話消息（包含 system 和 user）
   * @param stream 是否使用流式輸出
   */
  async run(
    initialMessages: ChatMessage[],
    stream = false
  ): Promise<OrchestratorResult> {
    const messages: ChatMessage[] = [...initialMessages];
    let iterations = 0;
    let toolCallsExecuted = 0;
    let finalResponse = "";

    // 添加工具定義到 system message（如果有工具）
    const toolDefinitions = this.toolRegistry.getAllDefinitions();
    if (toolDefinitions.length > 0 && messages[0]?.role === "system") {
      messages[0].content = this.injectToolDefinitions(messages[0].content, toolDefinitions);
    }

    try {
      while (iterations < this.maxIterations) {
        iterations++;

        if (this.verbose) {
          console.log(chalk.blue(`\n[循環 ${iterations}/${this.maxIterations}]`));
        }

        // 調用 LLM
        let assistantResponse: string;
        if (stream && iterations === 1) {
          // 第一輪使用流式輸出（展示給用戶）
          assistantResponse = await this.streamResponse(messages);
        } else {
          // 後續輪次不流式（內部處理）
          assistantResponse = await this.llmClient.chat(messages);
        }

        // 解析工具調用
        const { toolCalls, textContent } = parseToolCalls(assistantResponse);

        finalResponse = textContent;

        // 如果沒有工具調用，任務完成
        if (toolCalls.length === 0) {
          if (this.verbose) {
            console.log(chalk.green("\n✓ 任務完成（無需更多工具調用）"));
          }
          break;
        }

        // 顯示工具調用信息
        if (this.verbose || iterations === 1) {
          console.log(chalk.cyan(`\n[將執行 ${toolCalls.length} 個工具調用]`));
        }

        // 將 assistant 回應加入對話歷史
        messages.push({
          role: "assistant",
          content: assistantResponse,
        });

        // 執行所有工具調用
        const toolResults: string[] = [];
        for (const toolCall of toolCalls) {
          const result = await this.toolExecutor.execute(toolCall);
          toolCallsExecuted++;

          const resultText = result.success
            ? result.output || "(成功，無輸出)"
            : `錯誤: ${result.error}`;

          toolResults.push(`[工具: ${toolCall.tool}]\n${resultText}`);

          // 如果工具失敗且不是 dry-run，可能需要停止
          if (!result.success && this.toolExecutor["context"].safetyMode !== "dry-run") {
            console.log(chalk.red(`\n✗ 工具執行失敗，停止任務`));
            return {
              success: false,
              finalResponse: textContent,
              iterations,
              toolCallsExecuted,
              error: result.error,
            };
          }
        }

        // 將工具結果作為 tool role 消息回饋給 LLM
        messages.push({
          role: "tool",
          content: toolResults.join("\n\n"),
        });

        // 如果是 dry-run，在第一輪後停止
        if (this.toolExecutor["context"].safetyMode === "dry-run" && iterations === 1) {
          console.log(chalk.yellow("\n[DRY-RUN] 模式，停止執行"));
          break;
        }
      }

      if (iterations >= this.maxIterations) {
        console.log(chalk.yellow(`\n⚠ 達到最大循環次數 (${this.maxIterations})，停止執行`));
      }

      return {
        success: true,
        finalResponse,
        iterations,
        toolCallsExecuted,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        finalResponse,
        iterations,
        toolCallsExecuted,
        error: errorMsg,
      };
    }
  }

  /**
   * 流式輸出 LLM 回應
   */
  private async streamResponse(messages: ChatMessage[]): Promise<string> {
    let fullResponse = "";
    console.log(chalk.cyan("\n[Bailu 回應]\n"));

    for await (const chunk of this.llmClient.chatStream(messages)) {
      process.stdout.write(chunk);
      fullResponse += chunk;
    }

    console.log("\n");
    return fullResponse;
  }

  /**
   * 將工具定義注入到 system message
   */
  private injectToolDefinitions(systemContent: string, tools: ToolDefinition[]): string {
    const toolsSection = this.formatToolDefinitions(tools);
    return `${systemContent}\n\n## 可用工具\n\n${toolsSection}\n\n## 工具調用格式\n\n使用以下 XML 格式調用工具：\n\n<action>\n<invoke tool="工具名稱">\n  <param name="參數名">參數值</param>\n</invoke>\n</action>`;
  }

  /**
   * 格式化工具定義為可讀文本
   */
  private formatToolDefinitions(tools: ToolDefinition[]): string {
    return tools
      .map((tool) => {
        const params = tool.parameters
          .map((p) => {
            const required = p.required ? "【必需】" : "【可選】";
            return `  - ${p.name} (${p.type}): ${required} ${p.description}`;
          })
          .join("\n");

        return `### ${tool.name}\n${tool.description}\n\n參數:\n${params}`;
      })
      .join("\n\n");
  }
}

