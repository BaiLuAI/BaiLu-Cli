/**
 * 子 Agent 系統 - 支持多種專用 Agent
 * 類似 Claude Code 的 AgentTool 架構，提高複雜任務的處理能力
 */

import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { parseToolCalls } from "../tools/parser.js";
import { ToolExecutionContext } from "../tools/types.js";
import { createSpinner } from "../utils/spinner.js";

/**
 * Agent 類型
 */
export type AgentType = 'explore' | 'plan' | 'verification' | 'general';

/**
 * Agent 配置
 */
export interface AgentConfig {
  type: AgentType;
  name: string;
  description: string;
  systemPrompt?: string;
  maxIterations?: number;
  verbose?: boolean;
}

/**
 * Agent 執行結果
 */
export interface AgentResult {
  success: boolean;
  output: string;
  iterations: number;
  toolCallsExecuted: number;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Agent 執行上下文
 */
export interface AgentExecutionContext {
  workspaceRoot: string;
  parentAgent?: string;
  taskId?: string;
}

/**
 * 基礎 Agent 類
 */
export abstract class BaseAgent {
  protected llmClient: LLMClient;
  protected toolRegistry: ToolRegistry;
  protected toolExecutor: ToolExecutor;
  protected config: AgentConfig;
  protected context: AgentExecutionContext;

  constructor(
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    executionContext: ToolExecutionContext,
    config: AgentConfig,
    context: AgentExecutionContext
  ) {
    this.llmClient = llmClient;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = new ToolExecutor(toolRegistry, executionContext);
    this.config = config;
    this.context = context;
  }

  /**
   * 執行 Agent 任務
   */
  async execute(task: string, workspaceContext: string): Promise<AgentResult> {
    const maxIterations = this.config.maxIterations || 10;
    let iterations = 0;
    let toolCallsExecuted = 0;
    let finalOutput = "";

    // 構建系統提示
    const systemPrompt = this.buildSystemPrompt(workspaceContext);
    
    // 構建消息
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: task },
    ];

    // 準備工具定義
    const toolDefinitions = this.toolRegistry.getAllDefinitions();
    const openaiTools = toolDefinitions.length > 0 ? this.convertToOpenAIFormat(toolDefinitions) : undefined;

    const spinner = createSpinner(`[${this.config.name} 執行中]`);
    spinner.start();

    try {
      while (iterations < maxIterations) {
        iterations++;

        // 調用 LLM
        const response = await this.llmClient.chat(messages, false, openaiTools);
        
        // 解析工具調用
        const { toolCalls, textContent } = parseToolCalls(response);
        finalOutput = textContent;

        // 如果沒有工具調用，任務完成
        if (toolCalls.length === 0) {
          break;
        }

        // 將 assistant 回應加入對話歷史
        messages.push({ role: "assistant", content: response });

        // 執行工具調用
        const toolResults: string[] = [];
        for (const toolCall of toolCalls) {
          const result = await this.toolExecutor.execute(toolCall);
          toolCallsExecuted++;

          if (result.success) {
            toolResults.push(`[工具: ${toolCall.tool}]\n${result.output || "(成功)"}`);
          } else {
            toolResults.push(`[工具: ${toolCall.tool}] 錯誤: ${result.error}`);
          }
        }

        // 將工具結果加入對話歷史
        messages.push({
          role: "user",
          content: `[工具執行結果]\n${toolResults.join("\n\n")}`,
        });
      }

      spinner.stop();

      return {
        success: true,
        output: finalOutput,
        iterations,
        toolCallsExecuted,
        metadata: {
          agentType: this.config.type,
          agentName: this.config.name,
        },
      };
    } catch (error) {
      spinner.stop();
      return {
        success: false,
        output: finalOutput,
        iterations,
        toolCallsExecuted,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 構建系統提示
   */
  protected abstract buildSystemPrompt(workspaceContext: string): string;

  /**
   * 轉換工具定義為 OpenAI 格式
   */
  private convertToOpenAIFormat(tools: any[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.reduce((acc: any, param: any) => {
            acc[param.name] = {
              type: param.type,
              description: param.description,
            };
            return acc;
          }, {}),
          required: tool.parameters.filter((p: any) => p.required).map((p: any) => p.name),
        },
      },
    }));
  }
}

/**
 * 探索 Agent - 專門用於探索代碼庫結構
 */
export class ExploreAgent extends BaseAgent {
  constructor(
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    executionContext: ToolExecutionContext,
    context: AgentExecutionContext
  ) {
    super(llmClient, toolRegistry, executionContext, {
      type: 'explore',
      name: '探索助手',
      description: '專門用於探索代碼庫結構，分析項目架構，查找特定文件或代碼',
      maxIterations: 15,
      verbose: false,
    }, context);
  }

  protected buildSystemPrompt(workspaceContext: string): string {
    return `你是一個代碼庫探索專家。你的任務是幫助用戶了解項目結構、查找特定文件或代碼。

## 你的能力
- 使用 file_search 工具按名稱搜索文件
- 使用 grep_search 工具在文件內容中搜索
- 使用 list_directory 工具查看目錄結構
- 使用 read_file 工具讀取文件內容

## 工作流程
1. 理解用戶的探索需求
2. 選擇合適的工具進行搜索
3. 分析搜索結果
4. 提供清晰的總結和發現

## 輸出格式
- 使用結構化的格式展示發現
- 提供文件路徑和相關代碼片段
- 總結項目架構和關鍵組件

## 工作區上下文
${workspaceContext}`;
  }
}

/**
 * 計劃 Agent - 專門用於生成實施計劃
 */
export class PlanAgent extends BaseAgent {
  constructor(
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    executionContext: ToolExecutionContext,
    context: AgentExecutionContext
  ) {
    super(llmClient, toolRegistry, executionContext, {
      type: 'plan',
      name: '計劃助手',
      description: '專門用於分析需求並生成詳細的實施計劃',
      maxIterations: 10,
      verbose: false,
    }, context);
  }

  protected buildSystemPrompt(workspaceContext: string): string {
    return `你是一個軟件工程計劃專家。你的任務是分析用戶需求並生成詳細的實施計劃。

## 你的能力
- 分析任務需求和約束條件
- 識別相關的文件和代碼
- 評估實施風險
- 生成詳細的執行步驟

## 計劃格式
請生成包含以下信息的計劃：
1. 任務概述
2. 相關文件分析
3. 實施步驟（每個步驟包含具體操作）
4. 風險評估
5. 預計時間

## 工具使用
- 使用 file_search 和 grep_search 了解現有代碼
- 使用 read_file 分析關鍵文件
- 基於分析結果生成計劃

## 工作區上下文
${workspaceContext}`;
  }
}

/**
 * 驗證 Agent - 專門用於驗證修改結果
 */
export class VerificationAgent extends BaseAgent {
  constructor(
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    executionContext: ToolExecutionContext,
    context: AgentExecutionContext
  ) {
    super(llmClient, toolRegistry, executionContext, {
      type: 'verification',
      name: '驗證助手',
      description: '專門用於驗證代碼修改的正確性，檢查錯誤和潛在問題',
      maxIterations: 12,
      verbose: false,
    }, context);
  }

  protected buildSystemPrompt(workspaceContext: string): string {
    return `你是一個代碼驗證專家。你的任務是驗證代碼修改的正確性，檢查錯誤和潛在問題。

## 你的能力
- 檢查語法錯誤
- 運行測試驗證
- 分析代碼邏輯
- 檢查類型安全
- 評估代碼質量

## 驗證流程
1. 檢查修改的文件
2. 運行相關測試
3. 分析代碼邏輯
4. 識別潛在問題
5. 提供修復建議

## 輸出格式
- 清晰列出發現的問題
- 提供問題的嚴重程度
- 給出具體的修復建議
- 總體驗證結果

## 工具使用
- 使用 read_file 檢查修改的文件
- 使用 run_command 運行測試
- 使用 grep_search 查找相關代碼

## 工作區上下文
${workspaceContext}`;
  }
}

/**
 * Agent 管理器 - 管理和協調多個 Agent
 */
export class AgentManager {
  private llmClient: LLMClient;
  private toolRegistry: ToolRegistry;
  private executionContext: ToolExecutionContext;
  private agents: Map<AgentType, BaseAgent> = new Map();

  constructor(
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    executionContext: ToolExecutionContext
  ) {
    this.llmClient = llmClient;
    this.toolRegistry = toolRegistry;
    this.executionContext = executionContext;
  }

  /**
   * 獲取或創建 Agent
   */
  getAgent(type: AgentType, context: AgentExecutionContext): BaseAgent {
    if (!this.agents.has(type)) {
      let agent: BaseAgent;
      
      switch (type) {
        case 'explore':
          agent = new ExploreAgent(this.llmClient, this.toolRegistry, this.executionContext, context);
          break;
        case 'plan':
          agent = new PlanAgent(this.llmClient, this.toolRegistry, this.executionContext, context);
          break;
        case 'verification':
          agent = new VerificationAgent(this.llmClient, this.toolRegistry, this.executionContext, context);
          break;
        default:
          throw new Error(`未知的 Agent 類型: ${type}`);
      }
      
      this.agents.set(type, agent);
    }
    
    return this.agents.get(type)!;
  }

  /**
   * 執行 Agent 任務
   */
  async executeAgentTask(
    type: AgentType,
    task: string,
    workspaceContext: string,
    context: AgentExecutionContext
  ): Promise<AgentResult> {
    const agent = this.getAgent(type, context);
    return await agent.execute(task, workspaceContext);
  }

  /**
   * 獲取所有可用的 Agent 類型
   */
  getAvailableAgentTypes(): AgentType[] {
    return ['explore', 'plan', 'verification'];
  }

  /**
   * 獲取 Agent 描述
   */
  getAgentDescription(type: AgentType): string {
    switch (type) {
      case 'explore':
        return '探索代碼庫結構，分析項目架構';
      case 'plan':
        return '分析需求並生成實施計劃';
      case 'verification':
        return '驗證代碼修改的正確性';
      default:
        return '通用 Agent';
    }
  }
}
