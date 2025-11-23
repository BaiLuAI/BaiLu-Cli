/**
 * Agent 編排器：協調 LLM 和工具執行的完整循環
 */

import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client";
import { ToolRegistry } from "../tools/registry";
import { ToolExecutor } from "../tools/executor";
import { parseToolCalls, formatToolResult } from "../tools/parser";
import { ToolExecutionContext, ToolDefinition, ToolCall } from "../tools/types";
import { ContextMemory } from "./memory";
import { DependencyAnalyzer } from "../analysis/dependencies";
import { createSpinner } from "../utils/spinner";

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
  private autoCompress: boolean;
  private memory: ContextMemory; // 上下文记忆
  private dependencyAnalyzer: DependencyAnalyzer; // 依赖分析器

  constructor(options: OrchestratorOptions) {
    this.llmClient = options.llmClient;
    this.toolRegistry = options.toolRegistry;
    this.toolExecutor = new ToolExecutor(options.toolRegistry, options.executionContext);
    this.maxIterations = options.maxIterations || Infinity; // 默认无限
    this.verbose = options.verbose || false;
    this.autoCompress = true; // 自动压缩
    this.memory = new ContextMemory(); // 初始化记忆系统
    this.dependencyAnalyzer = new DependencyAnalyzer(options.executionContext.workspaceRoot); // 初始化依赖分析器
  }

  /**
   * 估算消息的 token 数（粗略）
   */
  private estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const content = msg.content || "";
      // 中文 ~1.5 tokens/字，英文 ~0.25 tokens/word
      const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
      const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
      total += chineseChars * 1.5 + englishWords * 0.25;
    }
    return Math.ceil(total);
  }

  /**
   * 自动压缩对话历史（当超过阈值时）
   */
  private autoCompressMessages(messages: ChatMessage[], maxTokens: number = 8000): void {
    const currentTokens = this.estimateTokens(messages);
    const threshold = maxTokens * 0.8; // 80% 阈值

    if (currentTokens > threshold && messages.length > 10) {
      const systemMsg = messages[0];
      const recentMessages = messages.slice(-6); // 保留最近 3 轮
      const compressedCount = messages.length - recentMessages.length - 1;

      messages.length = 0;
      messages.push(systemMsg);
      messages.push({
        role: "system",
        content: `[對話歷史已自動壓縮，之前共 ${compressedCount} 條消息]`,
      });
      messages.push(...recentMessages);

      if (this.verbose) {
        console.log(chalk.yellow(`\n📦 自動壓縮：${currentTokens} tokens → ${this.estimateTokens(messages)} tokens (超過 ${threshold} 閾值)`));
      }
    }
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

    // 將記憶摘要添加到 system message
    const memorySummary = this.memory.generateMemorySummary();
    if (memorySummary && messages[0]?.role === "system") {
      messages[0].content = `${messages[0].content}\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n📝 上下文記憶\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n${memorySummary}\n`;
    }

    // 準備工具定義
    const toolDefinitions = this.toolRegistry.getAllDefinitions();
    const openaiTools = toolDefinitions.length > 0 ? this.convertToOpenAIFormat(toolDefinitions) : undefined;
    
    // 也添加到 system message（作為補充說明）
    if (toolDefinitions.length > 0 && messages[0]?.role === "system") {
      messages[0].content = this.injectToolDefinitions(messages[0].content, toolDefinitions);
    }

    try {
      // 无限循环，通过智能检测停止
      let consecutiveFailures = 0;
      let lastFailedTool = "";
      
      while (true) {
        iterations++;

        // 自动压缩对话历史（超过 80% 阈值时）
        if (this.autoCompress) {
          this.autoCompressMessages(messages);
        }

        if (this.verbose) {
          console.log(chalk.blue(`\n[迭代 ${iterations}]`));
        }

        // 顯示 AI 思考狀態（使用動態 spinner）
        const modelName = this.llmClient.getModelName();
        let thinkingSpinner = null;
        
        if (iterations === 1) {
          thinkingSpinner = createSpinner(`[THINKING] ${modelName}`);
          thinkingSpinner.start();
        } else if (this.verbose) {
          console.log(chalk.gray(`[THINKING] ${modelName}...`));
        }

        // 調用 LLM
        let assistantResponse: string;
        if (stream) {
          // 使用流式輸出（更穩定，避免 JSON 解析問題）
          if (iterations === 1) {
            // 停止 spinner 並準備流式輸出
            if (thinkingSpinner) {
              thinkingSpinner.stop();
              thinkingSpinner = null;
            }
            // 第一輪：顯示給用戶
            assistantResponse = await this.streamResponse(messages, openaiTools);
          } else {
            // 後續輪次：靜默處理（避免干擾用戶）
            assistantResponse = await this.streamResponseSilent(messages, openaiTools);
          }
        } else {
          // 非流式模式（較少使用）
          assistantResponse = await this.llmClient.chat(messages, false, openaiTools);
          // 停止思考動畫
          if (thinkingSpinner) {
            thinkingSpinner.stop();
            thinkingSpinner = null;
          }
        }

        // 調試：記錄完整的 LLM 響應
        if (process.env.BAILU_DEBUG) {
          const fs = require('fs');
          const debugLog = `\n=== LLM 回應 (迭代 ${iterations}) ===\n${assistantResponse}\n=== 結束 ===\n`;
          fs.appendFileSync('debug-llm-response.log', debugLog, 'utf-8');
          console.log(chalk.gray(`[DEBUG] LLM 响应已记录到 debug-llm-response.log`));
        }

        // 解析工具調用
        const { toolCalls, textContent } = parseToolCalls(assistantResponse);

        finalResponse = textContent;

        // 如果沒有工具調用，任務完成
        if (toolCalls.length === 0) {
          if (this.verbose) {
            console.log(chalk.green("\n[SUCCESS] 任務完成（無需更多工具調用）"));
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
          // 顯示工具執行狀態
          const actionDesc = this.getToolActionDescription(toolCall);
          console.log(chalk.yellow(`\n[EXECUTING] ${modelName} ${actionDesc}...`));
          
          const result = await this.toolExecutor.execute(toolCall);
          toolCallsExecuted++;

          const resultText = result.success
            ? result.output || "(成功，無輸出)"
            : `錯誤: ${result.error}`;

          toolResults.push(`[工具: ${toolCall.tool}]\n${resultText}`);

          // 記錄到記憶系統
          this.memory.recordToolCall({
            tool: toolCall.tool,
            params: toolCall.params,
            result: {
              success: result.success,
              output: result.output,
              error: result.error,
            },
            timestamp: new Date(),
          });

          // 針對特定工具記錄到對應的記憶中
          if (result.success) {
            if (toolCall.tool === 'list_directory') {
              const files = result.output?.split('\n').filter(f => f.trim()) || [];
              this.memory.recordListDirectory(toolCall.params.path || '.', files);
            } else if (toolCall.tool === 'read_file') {
              this.memory.recordReadFile(toolCall.params.path, result.output || '');
            } else if (toolCall.tool === 'write_file') {
              this.memory.recordFileModification(toolCall.params.path);
            }
          }

          // 顯示工具執行結果給用戶
          if (result.success) {
            console.log(chalk.green(`[SUCCESS] 工具執行成功`));
            if (result.output && result.output.trim()) {
              console.log(chalk.gray("\n" + result.output.trim() + "\n"));
            }
            // 成功则重置失败计数
            consecutiveFailures = 0;
            lastFailedTool = "";
          } else {
            console.log(chalk.red(`[ERROR] 執行失敗: ${result.error}`));
            hasFailure = true;
            
            // 检测是否是连续相同工具失败
            if (lastFailedTool === toolCall.tool) {
              consecutiveFailures++;
            } else {
              consecutiveFailures = 1;
              lastFailedTool = toolCall.tool;
            }
          }

          // 如果工具失敗，記錄但繼續（給 AI 機會修復）
          if (!result.success) {
            console.log(chalk.yellow(`\n[WARNING] 工具執行失敗，錯誤已反饋給 AI 嘗試修復...`));
          }
        }
        
        // 智能停止：同一工具连续失败 5 次则停止（避免死循环）
        if (consecutiveFailures >= 5) {
          console.log(chalk.red(`\n[ERROR] 工具 "${lastFailedTool}" 連續失敗 ${consecutiveFailures} 次，停止執行`));
          console.log(chalk.yellow(`建議：`));
          console.log(chalk.cyan(`   1. 檢查工具參數是否正確`));
          console.log(chalk.cyan(`   2. 嘗試更明確的指令`));
          console.log(chalk.cyan(`   3. 切換到其他模型或手動完成\n`));
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

      // 无限循环模式，只在智能检测到问题时停止
      if (this.verbose) {
        console.log(chalk.green(`\n[SUCCESS] 任務完成，共執行 ${iterations} 輪迭代`));
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
   * 流式輸出 LLM 回應（顯示給用戶）
   */
  private async streamResponse(messages: ChatMessage[], tools?: any[]): Promise<string> {
    let fullResponse = "";
    
    // 顯示 Bailu 標籤（與 prompt "你: " 對應）
    // 注意：spinner.stop() 已經換行，這裡不需要額外的 \n
    process.stdout.write(chalk.cyan("Bailu: "));

    try {
      for await (const chunk of this.llmClient.chatStream(messages, tools)) {
        process.stdout.write(chunk);
        fullResponse += chunk;
      }
    } catch (error) {
      // 流式響應可能包含格式錯誤的數據塊，但已接收的內容仍然有效
      if (this.verbose) {
        console.log(chalk.yellow(`\n[警告] 流式響應中斷: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    // 輸出完成後換行（準備下一輪輸入）
    process.stdout.write("\n");
    return fullResponse;
  }

  /**
   * 流式處理 LLM 回應（靜默模式，用於後續輪次）
   */
  private async streamResponseSilent(messages: ChatMessage[], tools?: any[]): Promise<string> {
    let fullResponse = "";

    try {
      for await (const chunk of this.llmClient.chatStream(messages, tools)) {
        fullResponse += chunk;
        // 在 verbose 模式下可以選擇顯示進度
        if (this.verbose) {
          process.stdout.write(chalk.gray(chunk));
        }
      }
    } catch (error) {
      // 靜默處理錯誤，但記錄到日誌
      if (this.verbose) {
        console.log(chalk.yellow(`\n[警告] 流式響應中斷: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    if (this.verbose) {
      process.stdout.write("\n");
    }
    
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

  /**
   * 獲取記憶系統實例
   */
  getMemory(): ContextMemory {
    return this.memory;
  }

  /**
   * 記錄用戶請求
   */
  recordUserRequest(request: string): void {
    this.memory.recordUserRequest(request);
  }

  /**
   * 記錄重要決定
   */
  recordDecision(decision: string): void {
    this.memory.recordDecision(decision);
  }

  /**
   * 獲取依賴分析器實例
   */
  getDependencyAnalyzer(): DependencyAnalyzer {
    return this.dependencyAnalyzer;
  }

  /**
   * 獲取工具操作的友好描述
   */
  private getToolActionDescription(toolCall: ToolCall): string {
    const { tool, params } = toolCall;

    switch (tool) {
      case "read_file":
        return `正在查看 ${chalk.cyan(params.path)}`;
      
      case "write_file":
        return `正在編輯 ${chalk.cyan(params.path)}`;
      
      case "list_directory":
        return `正在瀏覽目錄 ${chalk.cyan(params.path || ".")}`;
      
      case "run_command":
        return `正在執行命令 ${chalk.cyan(params.command)}`;
      
      case "apply_diff":
        return `正在應用修改到 ${chalk.cyan(params.path)}`;
      
      default:
        return `正在執行 ${tool}`;
    }
  }
}
