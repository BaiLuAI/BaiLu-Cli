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
import { handleSlashCommand } from "./slash-commands";
import { showSlashCommandPicker } from "./autocomplete";

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
  private workspaceContext: WorkspaceContext;
  private sessionStats = {
    messagesCount: 0,
    toolCallsCount: 0,
    startTime: new Date(),
  };

  constructor(options: ChatSessionOptions) {
    this.llmClient = options.llmClient;
    this.workspaceContext = options.workspaceContext;
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
  async start(): Promise<void> {
    this.printWelcome();

    this.rl.prompt();

    this.rl.on("line", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      // 暫停 readline 以避免在處理期間顯示多餘的 prompt
      this.rl.pause();

      // 舊的特殊命令（保持向後兼容）
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(chalk.gray("再見！"));
        this.rl.close();
        process.exit(0);
      }

      if (trimmed === "clear") {
        this.messages = [this.messages[0]]; // 保留 system message
        this.sessionStats.messagesCount = 0;
        console.log(chalk.green("✓ 對話歷史已清空"));
        this.rl.resume();
        this.rl.prompt();
        return;
      }

      // 處理斜線命令
      if (trimmed.startsWith("/")) {
        // 如果只輸入了 "/"，顯示命令選擇器
        if (trimmed === "/") {
          // 完全關閉當前 readline，避免衝突
          this.rl.pause();
          
          try {
            const selectedCommand = await showSlashCommandPicker();
            
            if (selectedCommand) {
              // 手動處理選中的命令
              const slashResult = await handleSlashCommand(selectedCommand, {
                llmClient: this.llmClient,
                workspaceContext: this.workspaceContext,
                messages: this.messages,
                sessionStats: this.sessionStats,
              });

              if (slashResult.handled) {
                if (slashResult.response) {
                  console.log(slashResult.response);
                }

                if (slashResult.shouldExit) {
                  console.log(chalk.gray("再見！"));
                  this.rl.close();
                  process.exit(0);
                }

                if (slashResult.shouldClearHistory) {
                  this.messages = [this.messages[0]];
                  this.sessionStats.messagesCount = 0;
                }
              }
            }
          } finally {
            this.rl.resume();
            this.rl.prompt();
          }
          return;
        }

        const slashResult = await handleSlashCommand(trimmed, {
          llmClient: this.llmClient,
          workspaceContext: this.workspaceContext,
          messages: this.messages,
          sessionStats: this.sessionStats,
        });

        if (slashResult.handled) {
          if (slashResult.response) {
            console.log(slashResult.response);
          }

          if (slashResult.shouldExit) {
            console.log(chalk.gray("再見！"));
            this.rl.close();
            process.exit(0);
          }

          if (slashResult.shouldClearHistory) {
            this.messages = [this.messages[0]]; // 保留 system message
            this.sessionStats.messagesCount = 0;
          }

          this.rl.resume();
          this.rl.prompt();
          return;
        }
      }

      // 將用戶消息加入歷史
      this.messages.push({
        role: "user",
        content: trimmed,
      });
      this.sessionStats.messagesCount++;

      // 使用 orchestrator 處理（支持工具調用）
      const result = await this.orchestrator.run(this.messages, true);

      if (result.success) {
        // 將 assistant 回應加入歷史
        this.messages.push({
          role: "assistant",
          content: result.finalResponse,
        });
        this.sessionStats.messagesCount++;
        this.sessionStats.toolCallsCount += result.toolCallsExecuted;
      } else {
        console.log(chalk.red(`\n錯誤: ${result.error}`));
      }

      // AI 回應完成後恢復 readline 並顯示提示符
      this.rl.resume();
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

重要注意事項：
- 請用中文回應，並保持簡潔、準確
- 當需要執行操作時，使用提供的工具
- 不要在回應中模擬用戶輸入或包含 "你:" 這樣的提示符
- 直接回應用戶的問題，不要添加對話格式標記`;
  }

  /**
   * 顯示歡迎信息
   */
  private printWelcome(): void {
    console.log(chalk.green("\n╔════════════════════════════════════════════════════╗"));
    console.log(chalk.green("║") + chalk.bold.cyan("      Bailu Chat - AI 交互模式              ") + chalk.green("║"));
    console.log(chalk.green("╚════════════════════════════════════════════════════╝"));

    console.log(chalk.gray("\n💡 快速開始："));
    console.log(chalk.cyan("  • 直接輸入問題或需求，AI 會自動處理"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/") + chalk.cyan(" 顯示所有斜線命令（可用上下鍵選擇）"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/help") + chalk.cyan(" 查看命令說明"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/status") + chalk.cyan(" 查看當前狀態"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("exit") + chalk.cyan(" 退出"));

    const currentModel = this.llmClient["model"];
    const safetyMode = process.env.BAILU_MODE || "review";

    console.log(chalk.gray("\n⚙️  當前配置："));
    console.log(chalk.gray(`  模型: ${chalk.yellow(currentModel)}`));
    console.log(chalk.gray(`  模式: ${chalk.yellow(safetyMode)}`));
    console.log(chalk.gray(`  工作區: ${chalk.yellow(this.workspaceContext.rootPath)}`));
    console.log();
  }
}


