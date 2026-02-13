/**
 * Agent 編排器：協調 LLM 和工具執行的完整循環
 */

import os from "os";
import path from "path";
import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { parseToolCalls, formatToolResult } from "../tools/parser.js";
import { ToolExecutionContext, ToolDefinition, ToolCall } from "../tools/types.js";
import { ContextMemory } from "./memory.js";
import { DependencyAnalyzer } from "../analysis/dependencies.js";
import { createSpinner, Spinner } from "../utils/spinner.js";
import { renderMarkdown } from "../utils/markdown-renderer.js";
import { StreamingPanel } from "../utils/streaming-panel.js";
import { createLogger } from "../utils/logger.js";
import { runCommandSafe } from "../runtime/runner.js";
import { getDefaultPolicy } from "../runtime/policy.js";

const logger = createLogger('Orchestrator');

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
  // 返回完整的对话历史（包含任务规划、工具结果等）
  messages?: ChatMessage[];
}

/**
 * 模型 context window 大小映射（tokens）
 * 用於動態調整對話壓縮閾值
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'bailu-2.6-preview': 32000,
  'bailu-2.6': 32000,
  'bailu-2.6-fast-thinking': 32000,
  'bailu-2.6-mini': 16000,
  'bailu-2.5-pro': 32000,
  'bailu-2.5-lite-code': 16000,
  'bailu-2.5-code-cc': 16000,
  'bailu-Edge': 8000,
  'bailu-Minimum-free': 8000,
};

const DEFAULT_CONTEXT_WINDOW = 16000;

export class AgentOrchestrator {
  // Regular expressions for token estimation (compiled once for performance)
  private static readonly CHINESE_CHAR_PATTERN = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g;
  private static readonly ENGLISH_WORD_PATTERN = /[a-zA-Z]+/g;
  
  private llmClient: LLMClient;
  private toolExecutor: ToolExecutor;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private verbose: boolean;
  private autoCompress: boolean;
  private memory: ContextMemory; // 上下文记忆
  private dependencyAnalyzer: DependencyAnalyzer; // 依赖分析器
  private workspaceRoot: string; // 工作區根目錄

  constructor(options: OrchestratorOptions) {
    this.llmClient = options.llmClient;
    this.toolRegistry = options.toolRegistry;
    this.toolExecutor = new ToolExecutor(options.toolRegistry, options.executionContext);
    // Set reasonable default max iterations to prevent infinite loops
    this.maxIterations = options.maxIterations ?? 100;
    if (this.maxIterations === Infinity || this.maxIterations > 1000) {
      logger.warn('maxIterations 设置过大，可能导致性能问题');
    }
    this.verbose = options.verbose || false;
    this.autoCompress = true; // 自动压缩
    this.memory = new ContextMemory(); // 初始化记忆系统
    this.dependencyAnalyzer = new DependencyAnalyzer(options.executionContext.workspaceRoot); // 初始化依赖分析器
    this.workspaceRoot = options.executionContext.workspaceRoot;
  }

  /**
   * Estimate token count for messages (approximate)
   * Uses pre-compiled regex patterns for better performance
   */
  private estimateTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const content = msg.content || "";
      // Chinese characters (including CJK unified ideographs, symbols, and full-width chars)
      // ~1.5 tokens per character
      const chineseChars = (content.match(AgentOrchestrator.CHINESE_CHAR_PATTERN) || []).length;
      // English words ~1.3 tokens per word
      const englishWords = (content.match(AgentOrchestrator.ENGLISH_WORD_PATTERN) || []).length;
      // Other characters (numbers, punctuation, code symbols) ~0.5 tokens each
      const otherChars = content.length - chineseChars - (content.match(AgentOrchestrator.ENGLISH_WORD_PATTERN) || []).join('').length;
      total += chineseChars * 1.5 + englishWords * 1.3 + Math.max(0, otherChars) * 0.5;
    }
    return Math.ceil(total);
  }

  /**
   * Auto-compress conversation history when exceeding threshold
   * Keeps system message + last 6 messages (typically 3 user-assistant rounds)
   */
  private getModelContextWindow(): number {
    const modelName = this.llmClient.getModelName();
    return MODEL_CONTEXT_WINDOWS[modelName] || DEFAULT_CONTEXT_WINDOW;
  }

  private autoCompressMessages(messages: ChatMessage[], maxTokens?: number): void {
    const effectiveMax = maxTokens ?? this.getModelContextWindow();
    const currentTokens = this.estimateTokens(messages);
    const threshold = effectiveMax * 0.8; // 80% threshold

    if (currentTokens > threshold && messages.length > 10) {
      const systemMsg = messages[0];
      // Keep last 6 messages (approximately 3 conversation rounds if no tool calls)
      const recentMessages = messages.slice(-6);
      const compressedCount = messages.length - recentMessages.length - 1;

      messages.length = 0;
      messages.push(systemMsg);
      messages.push({
        role: "system",
        content: `[對話歷史已自動壓縮，之前共 ${compressedCount} 條消息]`,
      });
      messages.push(...recentMessages);

      if (this.verbose) {
        logger.info(`自動壓縮：${currentTokens} tokens → ${this.estimateTokens(messages)} tokens (超過 ${threshold} 閾值)`);
      }
    }
  }

  /**
   * 執行完整的 Agent 循環
   * @param initialMessages 初始對話消息（包含 system 和 user）
   * @param stream 是否使用流式輸出
   * @param silent 是否靜默模式（不直接輸出，由調用者處理）
   */
  async run(
    initialMessages: ChatMessage[],
    stream = false,
    silent = false
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
      
      while (iterations < this.maxIterations) {
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
        let thinkingSpinner: Spinner | null = null;
        
        // 每一輪都顯示 thinking spinner（不再區分第一輪和後續輪）
        thinkingSpinner = createSpinner(`[THINKING] ${modelName}`);
        thinkingSpinner.start();

        // 調用 LLM
        let assistantResponse: string;
        if (stream) {
          // 使用流式輸出（更穩定，避免 JSON 解析問題）
          // 所有輪次都傳入 spinner，在收到第一個 chunk 時停止
          assistantResponse = await this.streamResponse(messages, openaiTools, thinkingSpinner, silent);
          thinkingSpinner = null; // 已在 streamResponse 中停止
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
          const fs = await import('fs');
          const debugLog = `\n=== LLM 回應 (迭代 ${iterations}) ===\n${assistantResponse}\n=== 結束 ===\n`;
          const debugDir = process.platform === 'win32'
            ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'bailu-cli', 'debug')
            : path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'bailu-cli', 'debug');
          fs.mkdirSync(debugDir, { recursive: true });
          fs.appendFileSync(path.join(debugDir, 'llm-response.log'), debugLog, 'utf-8');
          logger.debug(`LLM 响应已记录到 ${debugDir}/llm-response.log`);
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
          // 顯示工具執行狀態（使用靜態消息，不用 spinner）
          // 原因：如果工具需要用戶確認，spinner 會干擾輸入
          const actionDesc = this.getToolActionDescription(toolCall);
          console.log(chalk.cyan(`[EXECUTING] ${modelName} ${actionDesc}`));
          
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
        
        // 自動測試驗證：如果有文件被修改，且配置了 testCommand，自動跑測試
        const hasFileModification = toolCalls.some(
          tc => (tc.tool === 'write_file' || tc.tool === 'apply_diff') && !hasFailure
        );
        if (hasFileModification) {
          const testResult = await this.runAutoTest();
          if (testResult) {
            toolResults.push(testResult);
          }
        }

        // 智能停止：同一工具连续失败 3 次则停止（避免死循环）
        if (consecutiveFailures >= 3) {
          logger.error(`工具 "${lastFailedTool}" 連續失敗 ${consecutiveFailures} 次，停止執行`);
          console.log(chalk.red(`\n[ERROR] 工具 "${lastFailedTool}" 連續失敗 ${consecutiveFailures} 次，停止執行`));
          console.log(chalk.yellow(`\n建議：`));
          console.log(chalk.cyan(`   1. 檢查工具參數是否正確`));
          console.log(chalk.cyan(`   2. 嘗試更明確的指令`));
          console.log(chalk.cyan(`   3. 換個方式或手動完成此操作\n`));
          break;
        }

        // 將工具結果作為 user role 消息回饋給 LLM
        // 注意：白鹿 API 可能不支持標準的 tool role，改用 user role
        // 強制要求 AI 解釋結果（解決 AI 只顯示原始輸出不解釋的問題）
        const toolResultsWithPrompt = `[工具執行結果]\n${toolResults.join("\n\n")}\n\n[重要提示] 請向用戶簡潔地解釋以上結果的含義。不要只顯示原始數據，要說明這些結果代表什麼、有什麼重要信息。`;
        
        messages.push({
          role: "user",
          content: toolResultsWithPrompt,
        });

        // 如果是 dry-run，在第一輪後停止
        if (this.toolExecutor["context"].safetyMode === "dry-run" && iterations === 1) {
          console.log(chalk.yellow("\n[DRY-RUN] 模式，停止執行"));
          break;
        }
      }

      // 检查是否因达到最大迭代次数而退出
      if (iterations >= this.maxIterations) {
        logger.warn(`已達到最大迭代次數 (${this.maxIterations})，停止執行`);
        console.log(chalk.yellow(`\n[WARNING] 已達到最大迭代次數 (${this.maxIterations})，停止執行`));
        return {
          success: false,
          finalResponse,
          iterations,
          toolCallsExecuted,
          error: `已達到最大迭代次數 (${this.maxIterations})`,
          messages: messages.slice(1),
        };
      }

      if (this.verbose) {
        console.log(chalk.green(`\n[SUCCESS] 任務完成，共執行 ${iterations} 輪迭代`));
      }

      return {
        success: true,
        finalResponse,
        iterations,
        toolCallsExecuted,
        // 返回完整的对话历史（去除 system message 修改）
        messages: messages.slice(1), // 跳过第一个 system message（已被修改）
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        finalResponse,
        iterations,
        toolCallsExecuted,
        error: errorMsg,
        messages: messages.slice(1),
      };
    }
  }

  /**
   * 流式輸出 LLM 回應（顯示給用戶）
   */
  private async streamResponse(messages: ChatMessage[], tools?: any[], spinner?: Spinner | null, silent = false): Promise<string> {
    let fullResponse = "";
    let insideAction = false;
    let outputtedLength = 0; // 已輸出的字符數
    
    // 創建流式面板
    const modelName = this.llmClient.getModelName();
    let panel: StreamingPanel | null = null;
    
    if (!silent) {
      panel = new StreamingPanel({
        title: 'AI 助手',
        modelName: modelName,
        borderColor: 'green',
      });
    }

    try {
      // 停止 thinking spinner
      if (spinner) {
        spinner.stop();
      }

      // 開始流式面板
      if (panel) {
        panel.start();
      }

      for await (const chunk of this.llmClient.chatStream(messages, tools)) {
        fullResponse += chunk;
        
        if (!insideAction) {
          // 檢查完整響應中是否有 <action> 標籤
          const actionStartIdx = fullResponse.indexOf('<action>');
          
          if (actionStartIdx !== -1) {
            // 找到 action 標籤
            insideAction = true;
            
            // 輸出 action 之前尚未輸出的部分
            if (actionStartIdx > outputtedLength && panel) {
              const textToOutput = fullResponse.substring(outputtedLength, actionStartIdx);
              panel.write(textToOutput);
              outputtedLength = actionStartIdx;
            }
          } else if (panel) {
            // 沒有 action 標籤，輸出新收到的 chunk
            panel.write(chunk);
            outputtedLength = fullResponse.length;
          }
        }
        // 在 action 內部，不輸出（但繼續收集完整響應）
      }

      // 結束流式面板
      if (panel) {
        panel.end();
      }

    } catch (error) {
      // 流式響應可能中斷
      if (panel) {
        panel.end();
      }
      if (spinner) {
        spinner.stop();
      }
      logger.warn(`流式響應中斷: ${error instanceof Error ? error.message : String(error)}`);
    }

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
      logger.warn(`流式響應中斷: ${error instanceof Error ? error.message : String(error)}`);
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
   * 自動測試驗證：讀取 .bailu.yml 中的 testCommand 並執行
   * @returns 測試結果字串（用於反饋給 AI），若無 testCommand 則返回 null
   */
  private async runAutoTest(): Promise<string | null> {
    try {
      // 動態讀取 .bailu.yml 配置
      const fs = await import('fs');
      const path = await import('path');
      const YAML = await import('yaml');
      
      const configPath = path.default.join(this.workspaceRoot, '.bailu.yml');
      if (!fs.default.existsSync(configPath)) {
        return null;
      }

      const raw = fs.default.readFileSync(configPath, 'utf8');
      const config = YAML.parse(raw);
      const testCommand = config?.testCommand;

      if (!testCommand || typeof testCommand !== 'string') {
        return null;
      }

      console.log(chalk.cyan(`\n[AUTO-TEST] 正在執行測試: ${testCommand}`));

      const policy = getDefaultPolicy();
      policy.maxCommandDurationMs = 60 * 1000; // 測試最多 60 秒

      const result = await runCommandSafe(this.workspaceRoot, testCommand, [], policy);

      if (result.exitCode === 0) {
        console.log(chalk.green(`[AUTO-TEST] ✓ 測試通過`));
        return `[自動測試驗證]\n命令: ${testCommand}\n結果: ✓ 測試通過`;
      } else {
        const output = (result.stderr || result.stdout || '').slice(-2000); // 截取最後 2000 字元
        console.log(chalk.red(`[AUTO-TEST] ✗ 測試失敗 (退出碼: ${result.exitCode})`));
        if (output.trim()) {
          console.log(chalk.gray(output.trim().split('\n').slice(-10).join('\n')));
        }
        return `[自動測試驗證 — 失敗]\n命令: ${testCommand}\n退出碼: ${result.exitCode}\n錯誤輸出:\n${output}\n\n[重要] 測試失敗！請分析錯誤輸出並修復代碼，然後重新運行測試。`;
      }
    } catch (error) {
      logger.warn(`自動測試執行失敗: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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
