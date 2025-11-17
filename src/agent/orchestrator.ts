/**
 * Agent 編排器：協調 LLM 和工具執行的完整循環
 */

import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client";
import { ToolRegistry } from "../tools/registry";
import { ToolExecutor } from "../tools/executor";
import { parseToolCalls, formatToolResult } from "../tools/parser";
import { ToolExecutionContext, ToolDefinition, ToolCall } from "../tools/types";

/**
 * 工具調用人性化描述
 */
function humanizeToolCall(toolCall: ToolCall): string {
  const { tool, params } = toolCall;

  switch (tool) {
    case "read_file":
      return `讀取檔案 ${chalk.cyan(params.path)}`;
    
    case "write_file":
      return `寫入檔案 ${chalk.cyan(params.path)}`;
    
    case "list_directory":
      return `列出目錄 ${chalk.cyan(params.path || ".")}`;
    
    case "run_command":
      return `執行命令 ${chalk.cyan(params.command)}`;
    
    case "apply_diff":
      return `應用差異到 ${chalk.cyan(params.path)}`;
    
    default:
      return `執行 ${tool}`;
  }
}

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

    // 準備工具定義
    const toolDefinitions = this.toolRegistry.getAllDefinitions();
    const openaiTools = toolDefinitions.length > 0 ? this.convertToOpenAIFormat(toolDefinitions) : undefined;
    
    // 也添加到 system message（作為補充說明）
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
          assistantResponse = await this.streamResponse(messages, openaiTools);
        } else {
          // 後續輪次不流式（內部處理）
          assistantResponse = await this.llmClient.chat(messages, false, openaiTools);
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

        // 顯示工具調用信息（人性化）
        if (this.verbose || iterations === 1) {
          console.log(chalk.cyan(`\n[將執行 ${toolCalls.length} 個操作]`));
          toolCalls.forEach((tc, idx) => {
            const humanDesc = humanizeToolCall(tc);
            console.log(chalk.gray(`  ${idx + 1}. ${humanDesc}`));
          });
        }

        // 將 assistant 回應加入對話歷史
        messages.push({
          role: "assistant",
          content: assistantResponse,
        });

        // 執行所有工具調用
        const toolResults: string[] = [];
        let hasFailure = false;
        
        for (const toolCall of toolCalls) {
          const result = await this.toolExecutor.execute(toolCall);
          toolCallsExecuted++;

          const resultText = result.success
            ? result.output || "(成功，無輸出)"
            : `錯誤: ${result.error}`;

          toolResults.push(`[工具: ${toolCall.tool}]\n${resultText}`);

          // 顯示工具執行結果給用戶
          if (result.success) {
            console.log(chalk.green(`✓ 工具執行成功`));
            if (result.output && result.output.trim()) {
              console.log(chalk.gray("\n" + result.output.trim() + "\n"));
            }
          } else {
            console.log(chalk.red(`✗ 執行失敗: ${result.error}`));
            hasFailure = true;
          }

          // 如果工具失敗，記錄但繼續（給 AI 機會修復）
          if (!result.success) {
            console.log(chalk.yellow(`\n⚠️  工具執行失敗，錯誤已反饋給 AI 嘗試修復...`));
          }
        }
        
        // 如果有失敗且已經重試多次，停止循環
        if (hasFailure && iterations >= 3) {
          console.log(chalk.yellow(`\n⚠️  已嘗試 ${iterations} 次，建議：`));
          console.log(chalk.cyan(`   1. 使用更明確的指令（例如："寫入 index.html，添加聯絡表單"）`));
          console.log(chalk.cyan(`   2. 或者讓 AI 只顯示內容，然後手動保存`));
          console.log(chalk.cyan(`   3. 嘗試切換到其他支援工具調用的模型\n`));
          break;
        }

        // 將工具結果作為 user role 消息回饋給 LLM
        // 注意：白鹿 API 可能不支持標準的 tool role，改用 user role
        messages.push({
          role: "user",
          content: `[工具執行結果]\n${toolResults.join("\n\n")}`,
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
  private async streamResponse(messages: ChatMessage[], tools?: any[]): Promise<string> {
    let fullResponse = "";
    
    // 顯示 Bailu 標籤（與 prompt "你: " 對應）
    process.stdout.write(chalk.cyan("\nBailu: "));

    for await (const chunk of this.llmClient.chatStream(messages, tools)) {
      process.stdout.write(chunk);
      fullResponse += chunk;
    }

    // 輸出完成後換行（準備下一輪輸入）
    process.stdout.write("\n");
    return fullResponse;
  }
  
  /**
   * 轉換工具定義為 OpenAI 格式
   */
  private convertToOpenAIFormat(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.reduce((acc, param) => {
            acc[param.name] = {
              type: param.type,
              description: param.description,
            };
            return acc;
          }, {} as Record<string, any>),
          required: tool.parameters.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }

  /**
   * 將工具定義注入到 system message
   */
  private injectToolDefinitions(systemContent: string, tools: ToolDefinition[]): string {
    const toolsSection = this.formatToolDefinitions(tools);
    return `${systemContent}

## 可用工具

${toolsSection}

## 工具調用格式

**重要：** 使用以下 XML 格式調用工具，所有【必需】參數都必須提供：

<action>
<invoke tool="工具名稱">
  <param name="參數名1">參數值1</param>
  <param name="參數名2">參數值2</param>
</invoke>
</action>

**範例 - 寫入檔案：**
<action>
<invoke tool="write_file">
  <param name="path">index.html</param>
  <param name="content"><!DOCTYPE html>...</param>
</invoke>
</action>

**注意：** 如果只想顯示內容給用戶而不執行操作，請直接回應，不要使用工具調用格式。`;
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

