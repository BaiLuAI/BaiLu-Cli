/**
 * Agent 編排器：協調 LLM 和工具執行的完整循環
 */

import os from "os";
import path from "path";
import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { injectToolDefinitions } from "../llm/tool-injection.js";
import { globalCostTracker } from "../utils/cost-tracker.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { parseToolCalls } from "../tools/parser.js";
import { ToolExecutionContext, ToolDefinition, ToolCall } from "../tools/types.js";
import { ContextMemory } from "./memory.js";
import { ContextCompactor } from "./context-compactor.js";
import { runAutoTest } from "./auto-test.js";
import { getToolActionDescription, humanizeToolCall } from "./tool-display.js";
import { createSpinner, Spinner } from "../utils/spinner.js";
import { renderMarkdown } from "../utils/markdown-renderer.js";
import { StreamingPanel } from "../utils/streaming-panel.js";
import { createLogger } from "../utils/logger.js";
import { runCommandSafe } from "../runtime/runner.js";
import { getDefaultPolicy } from "../runtime/policy.js";

const logger = createLogger('Orchestrator');

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
  /** 是否被用戶中斷（Esc） */
  interrupted?: boolean;
  // 返回完整的对话历史（包含任务规划、工具结果等）
  messages?: ChatMessage[];
}


export class AgentOrchestrator {
  // Regular expressions for token estimation (compiled once for performance)
  private static readonly CHINESE_CHAR_PATTERN = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g;
  private static readonly ENGLISH_WORD_PATTERN = /[a-zA-Z]+/g;
  
  private llmClient: LLMClient;
  private toolExecutor: ToolExecutor;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private verbose: boolean;
  private memory: ContextMemory; // 上下文记忆
  private compactor: ContextCompactor; // 上下文壓縮器
  private workspaceRoot: string; // 工作區根目錄
  private executionContext: ToolExecutionContext; // 執行上下文

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
    this.memory = new ContextMemory(); // 初始化记忆系统
    this.compactor = new ContextCompactor(this.llmClient, options.verbose || false); // 上下文壓縮器
    this.workspaceRoot = options.executionContext.workspaceRoot;
    this.executionContext = options.executionContext;
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
    silent = false,
    signal?: AbortSignal
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

    // 將工具定義注入到 system message（使用白鹿 chat template 的格式）
    // 注意：即使傳了 API tools 參數，也需要在 system message 中顯式注入，
    // 因為 API 端可能不會自動將 tools 參數渲染進提示文本
    if (openaiTools && openaiTools.length > 0 && messages[0]?.role === "system") {
      messages[0].content = injectToolDefinitions(messages[0].content, openaiTools);
    }

    try {
      // 在開始串流前先確認模型可用（自動切換會在此發生，
      // 確保面板標題顯示實際使用的模型，警告也不會打斷面板）
      try {
        await this.llmClient.ensureModelAvailable();
      } catch {
        // 模型檢測失敗不阻斷任務，實際調用時會報錯
      }

      // 无限循环，通过智能检测停止
      let consecutiveFailures = 0;
      let lastFailedTool = "";
      
      while (iterations < this.maxIterations) {
        // 用戶中斷（Esc）：停止循環，保留已有進度
        if (signal?.aborted) {
          console.log(chalk.yellow("\n[中斷] 用戶中斷了當前回合"));
          return {
            success: true,
            finalResponse,
            iterations,
            toolCallsExecuted,
            interrupted: true,
            messages: messages.slice(initialMessages.length),
          };
        }

        iterations++;

        // 自动压缩对话历史（超过 80% 阈值时）
        await this.compactor.maybeCompress(messages, this.llmClient.getModelName());

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
          assistantResponse = await this.streamResponse(messages, openaiTools, thinkingSpinner, silent, signal);
          thinkingSpinner = null; // 已在 streamResponse 中停止
        } else {
          // 非流式模式（較少使用）
          assistantResponse = await this.llmClient.chat(messages, false, openaiTools, signal);
          // 停止思考動畫
          if (thinkingSpinner) {
            thinkingSpinner.stop();
            thinkingSpinner = null;
          }
        }

        // 用戶中斷：立即停止，不解析部分回應（避免執行不完整的工具調用）
        if (signal?.aborted) {
          console.log(chalk.yellow("\n[中斷] 用戶中斷了當前回合，已保留部分回應"));
          if (assistantResponse.trim()) {
            messages.push({ role: "assistant", content: assistantResponse });
            finalResponse = parseToolCalls(assistantResponse).textContent || finalResponse;
          }
          return {
            success: true,
            finalResponse,
            iterations,
            toolCallsExecuted,
            interrupted: true,
            messages: messages.slice(initialMessages.length),
          };
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

        // 解析工具調用（同時提取 <reasoning> 區塊）
        const { toolCalls, textContent, reasoning } = parseToolCalls(assistantResponse);

        finalResponse = textContent;

        // verbose 模式下顯示模型的推理過程
        if (reasoning && this.verbose) {
          console.log(chalk.gray(`\n[REASONING] ${reasoning.substring(0, 500)}${reasoning.length > 500 ? '...' : ''}`));
        }

        // 顯示 token 用量
        const usageLine = globalCostTracker.formatLastUsage();
        if (usageLine) {
          console.log(usageLine);
        }

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
          const actionDesc = getToolActionDescription(toolCall);
          console.log(chalk.cyan(`[EXECUTING] ${modelName} ${actionDesc}`));
          
          const result = await this.toolExecutor.execute(toolCall);
          toolCallsExecuted++;

          // 截斷過長的工具輸出，避免浪費 LLM context window
          let resultText: string;
          if (result.success) {
            const output = result.output || "(成功，無輸出)";
            const outputLines = output.split('\n');
            const MAX_LLM_LINES = 300;
            if (outputLines.length > MAX_LLM_LINES) {
              const headLines = outputLines.slice(0, 200).join('\n');
              const tailLines = outputLines.slice(-50).join('\n');
              resultText = `${headLines}\n\n[... 省略 ${outputLines.length - 250} 行，共 ${outputLines.length} 行。如需查看完整內容，請使用 start_line/end_line 參數分段讀取 ...]\n\n${tailLines}`;
            } else {
              resultText = output;
            }
          } else {
            resultText = `錯誤: ${result.error}`;
          }

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
          // 只讀工具（read_file, list_directory 等）只顯示一行摘要，不刷屏
          // 動作工具（run_command 等）顯示精簡輸出
          if (result.success) {
            const quietTools = ['read_file', 'list_directory', 'grep_search', 'file_search'];
            if (quietTools.includes(toolCall.tool)) {
              // 只讀工具：一行摘要
              const lineCount = result.output ? result.output.split('\n').length : 0;
              const sizeKB = result.output ? (Buffer.byteLength(result.output, 'utf-8') / 1024).toFixed(1) : '0';
              const filePath = toolCall.params.path || toolCall.params.pattern || '';
              console.log(chalk.green(`[SUCCESS]`) + chalk.gray(` ${filePath} (${lineCount} 行, ${sizeKB} KB)`));
            } else if (result.output && result.output.trim()) {
              // 動作工具：顯示精簡輸出（前 8 行 + 後 3 行）
              console.log(chalk.green(`[SUCCESS] 工具執行成功`));
              const MAX_DISPLAY_HEAD = 8;
              const MAX_DISPLAY_TAIL = 3;
              const lines = result.output.trim().split('\n');
              if (lines.length > MAX_DISPLAY_HEAD + MAX_DISPLAY_TAIL) {
                const head = lines.slice(0, MAX_DISPLAY_HEAD).join('\n');
                const tail = lines.slice(-MAX_DISPLAY_TAIL).join('\n');
                const omitted = lines.length - MAX_DISPLAY_HEAD - MAX_DISPLAY_TAIL;
                console.log(chalk.gray("\n" + head));
                console.log(chalk.yellow(`  ... (省略 ${omitted} 行，共 ${lines.length} 行)`));
                console.log(chalk.gray(tail + "\n"));
              } else {
                console.log(chalk.gray("\n" + result.output.trim() + "\n"));
              }
            } else {
              console.log(chalk.green(`[SUCCESS] 工具執行成功`));
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
          const testResult = await runAutoTest(this.workspaceRoot);
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

        // 將工具結果作為 user 消息回饋給 LLM
        // 注意：白鹿 API 可能不支持 tool role，使用 user role 確保兼容
        const toolResultsContent = `[工具執行結果]\n${toolResults.join("\n\n")}\n\n請根據以上工具執行結果，簡潔地回答用戶的問題。`;
        messages.push({
          role: "user",
          content: toolResultsContent,
        });

        // 如果是 dry-run，在第一輪後停止
        if (this.executionContext.safetyMode === "dry-run" && iterations === 1) {
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
          messages: messages.slice(initialMessages.length),
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
        // 只返回本次新增的對話（不含呼叫前已有的訊息，避免上層重複加入）
        messages: messages.slice(initialMessages.length),
      };
    } catch (error) {
      // 用戶中斷（Esc）：不算錯誤，保留已有進度
      if (signal?.aborted) {
        console.log(chalk.yellow("\n[中斷] 用戶中斷了當前回合"));
        return {
          success: true,
          finalResponse,
          iterations,
          toolCallsExecuted,
          interrupted: true,
          messages: messages.slice(initialMessages.length),
        };
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        finalResponse,
        iterations,
        toolCallsExecuted,
        error: errorMsg,
        messages: messages.slice(initialMessages.length),
      };
    }
  }

  /**
   * 流式輸出 LLM 回應（顯示給用戶）
   */
  private async streamResponse(messages: ChatMessage[], tools?: any[], spinner?: Spinner | null, silent = false, signal?: AbortSignal): Promise<string> {
    let fullResponse = "";
    let insideAction = false;
    let insideReasoning = false;
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

      // 待輸出緩衝區：避免 <reasoning> 或 <action> 標籤片段被提前顯示
      let pendingBuffer = "";
      const TAG_PREFIXES = ["<reasoning>", "<action>", "</reasoning>"];
      const MAX_TAG_LEN = "</reasoning>".length; // 最長標籤長度

      for await (const chunk of this.llmClient.chatStream(messages, tools, signal)) {
        fullResponse += chunk;
        pendingBuffer += chunk;

        // 在 reasoning 區塊內部：只檢測結束標籤
        if (insideReasoning) {
          if (pendingBuffer.includes("</reasoning>")) {
            insideReasoning = false;
            const endIdx = pendingBuffer.indexOf("</reasoning>") + "</reasoning>".length;
            pendingBuffer = pendingBuffer.substring(endIdx);
            outputtedLength = fullResponse.length - pendingBuffer.length;
          }
          continue;
        }

        // 在 action 區塊內部：不輸出
        if (insideAction) {
          pendingBuffer = "";
          outputtedLength = fullResponse.length;
          continue;
        }

        // 檢測 <reasoning> 開始
        const reasonIdx = pendingBuffer.indexOf("<reasoning>");
        if (reasonIdx !== -1) {
          insideReasoning = true;
          // 輸出 <reasoning> 之前的文字
          if (reasonIdx > 0 && panel) {
            panel.write(pendingBuffer.substring(0, reasonIdx));
          }
          pendingBuffer = pendingBuffer.substring(reasonIdx + "<reasoning>".length);
          outputtedLength = fullResponse.length - pendingBuffer.length;
          continue;
        }

        // 檢測 <action> 開始
        const actionIdx = pendingBuffer.indexOf("<action>");
        if (actionIdx !== -1) {
          insideAction = true;
          if (actionIdx > 0 && panel) {
            panel.write(pendingBuffer.substring(0, actionIdx));
          }
          pendingBuffer = "";
          outputtedLength = fullResponse.length;
          continue;
        }

        // 如果緩衝區末尾可能是標籤開頭（如 "<rea"），先不輸出
        // 只輸出安全的部分（不含末尾可能的標籤片段）
        const safeLen = pendingBuffer.length - MAX_TAG_LEN;
        if (safeLen > 0 && panel) {
          panel.write(pendingBuffer.substring(0, safeLen));
          pendingBuffer = pendingBuffer.substring(safeLen);
          outputtedLength = fullResponse.length - pendingBuffer.length;
        }
      }

      // 流結束後，輸出剩餘的安全緩衝內容
      if (pendingBuffer && !insideReasoning && !insideAction && panel) {
        panel.write(pendingBuffer);
      }

      // 結束流式面板
      if (panel) {
        panel.end();
      }

    } catch (error) {
      // 流式響應中斷：用戶主動中斷（Esc）時保留部分回應；其他錯誤向上抛出
      if (panel) {
        panel.end();
      }
      if (spinner) {
        spinner.stop();
      }
      if (signal?.aborted) {
        logger.info(`串流被用戶中斷，保留 ${fullResponse.length} 字符的部分回應`);
        return fullResponse;
      }
      logger.warn(`流式響應中斷: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
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
      // 靜默模式同樣向上抛出，由呼叫方統一處理
      logger.warn(`流式響應中斷: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
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
   * 獲取記憶系統實例
   */
  getMemory(): ContextMemory {
    return this.memory;
  }

  /**
   * 執行期更新安全模式（供 /mode 斜線命令使用）
   */
  updateSafetyMode(mode: ToolExecutionContext["safetyMode"]): void {
    this.executionContext.safetyMode = mode;
    this.toolExecutor.updateContext({ safetyMode: mode });
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

}
