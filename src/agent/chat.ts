/**
 * 交互式對話模式
 */

import readline from "readline";
import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client";
import { WorkspaceContext } from "./types";
import { ToolRegistry } from "../tools/registry";
import { AgentOrchestrator } from "./orchestrator";
import { ToolExecutionContext } from "../tools/types";

export interface ChatSessionOptions {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  workspaceContext: WorkspaceContext;
  executionContext: ToolExecutionContext;
}

export class ChatSession {
  private llmClient: LLMClient;
  private orchestrator: AgentOrchestrator;
  private messages: ChatMessage[];
  private rl: readline.Interface;

  constructor(options: ChatSessionOptions) {
    this.llmClient = options.llmClient;
    this.orchestrator = new AgentOrchestrator({
      llmClient: options.llmClient,
      toolRegistry: options.toolRegistry,
      executionContext: options.executionContext,
      maxIterations: 10,
      verbose: false, // chat 模式下默認不顯示詳細執行信息
    });

    // 初始化對話歷史（帶 system prompt）
    this.messages = [
      {
        role: "system",
        content: this.buildSystemPrompt(options.workspaceContext),
      },
    ];

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("\n你: "),
    });
  }

  /**
   * 開始交互式對話
   */
  async start(): void {
    console.log(chalk.green("\n[Bailu Chat 模式]"));
    console.log(chalk.gray("進入交互模式。輸入 'exit' 或 'quit' 退出，輸入 'clear' 清空對話歷史。\n"));

    this.rl.prompt();

    this.rl.on("line", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      // 特殊命令
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(chalk.gray("再見！"));
        this.rl.close();
        process.exit(0);
      }

      if (trimmed === "clear") {
        this.messages = [this.messages[0]]; // 保留 system message
        console.log(chalk.gray("對話歷史已清空"));
        this.rl.prompt();
        return;
      }

      // 將用戶消息加入歷史
      this.messages.push({
        role: "user",
        content: trimmed,
      });

      // 使用 orchestrator 處理（支持工具調用）
      console.log(chalk.cyan("\nBailu: "));
      const result = await this.orchestrator.run(this.messages, true);

      if (result.success) {
        // 將 assistant 回應加入歷史
        this.messages.push({
          role: "assistant",
          content: result.finalResponse,
        });
      } else {
        console.log(chalk.red(`\n錯誤: ${result.error}`));
      }

      this.rl.prompt();
    });

    this.rl.on("close", () => {
      console.log(chalk.gray("\n再見！"));
      process.exit(0);
    });
  }

  /**
   * 構建 system prompt
   */
  private buildSystemPrompt(ctx: WorkspaceContext): string {
    return `你是 Bailu，一個 AI 軟體工程助手，當前工作在以下代碼庫中：

工作目錄：${ctx.rootPath}
項目配置：${ctx.config?.testCommand ? `測試命令：${ctx.config.testCommand}` : "無"}

你可以：
- 回答關於代碼庫的問題
- 使用工具讀取/修改文件
- 執行命令
- 幫助用戶完成開發任務

請用中文回應，並保持簡潔、準確。當需要執行操作時，使用提供的工具。`;
  }
}

