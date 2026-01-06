/**
 * 交互式對話模式
 */

import readline from "readline";
import chalk from "chalk";
import { execSync } from "child_process";
import { LLMClient, ChatMessage } from "../llm/client.js";
import { WorkspaceContext } from "./types.js";
import { ToolRegistry } from "../tools/registry.js";
import { AgentOrchestrator } from "./orchestrator.js";
import { ToolExecutionContext } from "../tools/types.js";
import { handleSlashCommand } from "./slash-commands.js";
import { showSlashCommandPicker } from "./autocomplete.js";
import { HistoryManager } from "../utils/history.js";
import { getHistoryPath } from "../config.js";
import { ChatSessionManager, ChatSessionData } from "./chat-session-manager.js";
import { buildWorkspaceContext } from "./context.js";
import { PasteDetector } from "../utils/paste-detector.js";
import { 
  createUserPanel, 
  createAssistantPanel, 
  createSystemPanel,
  createErrorPanel,
  createSeparator,
  createStatsPanel,
  createCompactStatsPanel
} from "../utils/panel-formatter.js";

export interface ChatSessionOptions {
  llmClient: LLMClient;
  toolRegistry: ToolRegistry;
  workspaceContext: WorkspaceContext;
  executionContext: ToolExecutionContext;
}

export interface SessionStats {
  messagesCount: number;
  toolCallsCount: number;
  totalTokensUsed: number;
  totalResponseTime: number;
  apiCallsCount: number;
  filesModified: number;
  startTime: Date;
  lastRequestTime: number;
}

export class ChatSession {
  // ANSI escape codes for terminal control
  private readonly ANSI_MOVE_UP = '\x1b[1A'; // Move cursor up one line
  private readonly ANSI_CLEAR_LINE = '\x1b[2K'; // Clear entire line
  private readonly ANSI_CARRIAGE_RETURN = '\r'; // Move cursor to line start
  
  private llmClient: LLMClient;
  private orchestrator: AgentOrchestrator;
  private messages: ChatMessage[];
  private rl: readline.Interface;
  private workspaceContext: WorkspaceContext;
  private historyManager: HistoryManager;
  private sessionManager: ChatSessionManager;
  private pasteDetector!: PasteDetector; // 粘贴检测器
  private activeFiles: Set<string> = new Set(); // 当前上下文中的文件
  private recentAccessedFiles: string[] = []; // 最近访问的文件（用于上下文记忆）
  private readonly MAX_RECENT_FILES = 20; // 最近文件数量限制
  private multiLineBuffer: string[] = []; // 多行输入缓冲区
  private isMultiLineMode: boolean = false; // 是否在多行模式
  private readonly MAX_MULTILINE_LINES = 50; // 多行输入最大行数限制
  private sessionStats: SessionStats = {
    messagesCount: 0,
    toolCallsCount: 0,
    totalTokensUsed: 0,
    totalResponseTime: 0,
    apiCallsCount: 0,
    filesModified: 0,
    startTime: new Date(),
    lastRequestTime: 0,
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

    // 初始化历史记录管理器
    this.historyManager = new HistoryManager(getHistoryPath());

    // 初始化会话管理器
    this.sessionManager = new ChatSessionManager();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.bold.cyan("\nYou: "),
      terminal: true, // 确保作为终端模式运行
      crlfDelay: Infinity, // 处理 Windows 的 CRLF，避免重复行
    });

    // 初始化粘贴检测器
    this.pasteDetector = new PasteDetector({
      delay: 50, // 50ms足够检测快速粘贴，太长会导致每行单独处理
      longDelay: 150, // 150ms作为最终后备
      maxLines: 1000, // 限制最大行数，避免内存问题
      onComplete: async (lines, isPaste) => {
        if (isPaste) {
          // 多行粘贴
          await this.handlePastedInput(lines.join('\n'));
        } else {
          // 单行输入
          await this.handleSingleLine(lines[0]);
        }
      },
    });
  }


  /**
   * 開始交互式對話
   */
  async start(): Promise<void> {
    this.printWelcome();

    // Ctrl+C 处理：第一次提示，第二次（3秒内）退出
    let lastSigintTime: number | null = null;
    process.on('SIGINT', () => {
      const now = Date.now();

      if (lastSigintTime && (now - lastSigintTime) < 3000) {
        // 3秒内第二次 Ctrl+C，退出
        this.pasteDetector.destroy();
        console.log(chalk.gray("\n\n再見！"));
        process.exit(0);
      } else {
        // 第一次 Ctrl+C，提示
        console.log(chalk.yellow("\n\n[提示] 再按一次 Ctrl+C (3秒内) 退出，或輸入 'exit' 退出"));
        lastSigintTime = now;
        this.rl.prompt();
      }
    });

    this.rl.prompt();

    this.rl.on("line", (input) => {
      // 使用粘贴检测器处理所有输入
      this.pasteDetector.push(input);
    });

    this.rl.on("close", () => {
      this.pasteDetector.destroy();
    });
  }

  /**
   * 处理单行输入
   */
  private async handleSingleLine(input: string): Promise<void> {
    // 多行输入模式处理
    if (this.isMultiLineMode) {
      // 检查是否超过最大行数限制
      if (this.multiLineBuffer.length >= this.MAX_MULTILINE_LINES) {
        console.log(chalk.yellow(`\n⚠️  多行输入已达到最大限制 (${this.MAX_MULTILINE_LINES} 行)`));
        console.log(chalk.gray("自动提交当前内容...\n"));

        // 强制结束并提交
        this.multiLineBuffer.push(input);
        const fullInput = this.multiLineBuffer.join('\n');
        this.isMultiLineMode = false;
        this.multiLineBuffer = [];
        this.rl.setPrompt(chalk.cyan("\n你: "));

        if (fullInput.trim()) {
          await this.processMultiLineInput(fullInput);
        }
        this.rl.prompt();
        return;
      }

      // 检查当前行是否以 \ 结尾（续行）
      if (input.endsWith('\\')) {
        // 继续多行模式
        this.multiLineBuffer.push(input.slice(0, -1)); // 移除末尾的 \
        this.rl.setPrompt(chalk.gray("  ... "));
        this.rl.prompt();
        return;
      } else {
        // 没有 \，这是最后一行，结束并提交
        this.multiLineBuffer.push(input);
        const fullInput = this.multiLineBuffer.join('\n');
        this.isMultiLineMode = false;
        this.multiLineBuffer = [];
        this.rl.setPrompt(chalk.bold.cyan("\nYou: "));

        if (fullInput.trim()) {
          // 处理多行输入
          await this.processMultiLineInput(fullInput);
        }
        this.rl.prompt();
        return;
      }
    }

    // 单行模式
    const trimmed = input.trim();

    if (!trimmed) {
      this.rl.prompt();
      return;
    }

    // 检查行尾是否有续行符 \
    if (input.endsWith('\\')) {
      // 进入多行模式
      this.isMultiLineMode = true;
      this.multiLineBuffer = [input.slice(0, -1)]; // 移除末尾的 \
      this.rl.setPrompt(chalk.gray("  ... "));
      this.rl.prompt();
      return;
    }

    // 保存到历史记录
    this.historyManager.add(trimmed);

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
      // 如果只輸入了 /，顯示命令選擇器
      if (trimmed === "/") {
        const selectedCommand = await showSlashCommandPicker('/');

        if (selectedCommand) {
          // 執行選中的命令
          this.historyManager.add(selectedCommand);

          const result = await handleSlashCommand(selectedCommand, {
            llmClient: this.llmClient,
            workspaceContext: this.workspaceContext,
            messages: this.messages,
            sessionStats: this.sessionStats,
            fileManager: {
              addFile: this.addFile.bind(this),
              removeFile: this.removeFile.bind(this),
              clearFiles: this.clearFiles.bind(this),
              getActiveFiles: this.getActiveFiles.bind(this),
            },
            sessionManager: {
              saveCurrentSession: this.saveCurrentSession.bind(this),
              loadSession: this.loadSession.bind(this),
              listSessions: this.listSessions.bind(this),
              deleteSession: this.deleteSession.bind(this),
            },
          });

          if (result.handled) {
            if (result.response) {
              console.log(result.response);
            }

            if (result.shouldExit) {
              console.log(chalk.gray("再見！"));
              this.rl.close();
              process.exit(0);
            }

            if (result.shouldClearHistory) {
              this.messages = [this.messages[0]];
              this.sessionStats.messagesCount = 0;
            }
          }
        }

        // 修复 inquirer 导致的 stdin 问题
        await new Promise(resolve => setTimeout(resolve, 100));

        // 恢复 stdin 状态
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
          } catch (e) {
            // 忽略错误
          }
        }

        // 确保 stdin 被恢复
        process.stdin.resume();

        // 恢复 readline
        this.rl.resume();

        // 显示提示符
        this.rl.prompt();

        return;
      }

      // 處理其他斜線命令
      const slashResult = await handleSlashCommand(trimmed, {
        llmClient: this.llmClient,
        workspaceContext: this.workspaceContext,
        messages: this.messages,
        sessionStats: this.sessionStats,
        fileManager: {
          addFile: this.addFile.bind(this),
          removeFile: this.removeFile.bind(this),
          clearFiles: this.clearFiles.bind(this),
          getActiveFiles: this.getActiveFiles.bind(this),
        },
        sessionManager: {
          saveCurrentSession: this.saveCurrentSession.bind(this),
          loadSession: this.loadSession.bind(this),
          listSessions: this.listSessions.bind(this),
          deleteSession: this.deleteSession.bind(this),
        },
      });

      if (slashResult.handled) {
        if (slashResult.response) {
          console.log(slashResult.response);
        }

        // 将命令结果添加到对话历史（用于后续引用）
        if (slashResult.addToHistory) {
          this.messages.push({
            role: "user",
            content: slashResult.addToHistory.userMessage,
          });
          this.messages.push({
            role: "assistant",
            content: slashResult.addToHistory.assistantMessage,
          });
          this.sessionStats.messagesCount += 2;
        }

        if (slashResult.shouldExit) {
          console.log(chalk.gray("再見！"));
          this.rl.close();
          process.exit(0);
        }

        if (slashResult.shouldClearHistory) {
          this.messages = [this.messages[0]];
          this.sessionStats.messagesCount = 0;
          
          // 檢查是否需要清空記憶（根據命令判斷）
          // /clear-chat 的 response 包含 "保留工具記憶"，則不清空記憶
          const shouldKeepMemory = slashResult.response?.includes("保留工具記憶");
          
          if (!shouldKeepMemory && this.orchestrator) {
            // 只有 /clear 命令才清空記憶
            this.orchestrator.getMemory().reset();
          }
        }
      } else {
        // 未知命令，提示用户输入 / 查看命令列表
        console.log(chalk.red(`未知命令: ${trimmed}`));
        console.log(chalk.gray(`提示: 輸入 ${chalk.cyan('/')} 查看所有可用命令`));
      }

      this.rl.resume();
      this.rl.prompt();
      return;
    }

    // 刷新工作區上下文（更新 Git 狀態和最近文件）
    this.refreshWorkspaceContext();

    // 將用戶消息加入歷史
    this.messages.push({
      role: "user",
      content: trimmed,
    });
    this.sessionStats.messagesCount++;

    // 记录开始时间
    const startTime = Date.now();

    // 使用 orchestrator 處理（支持工具調用，使用靜默模式避免重複輸出）
    const result = await this.orchestrator.run(this.messages, true, true);

    // 更新统计信息
    const responseTime = Date.now() - startTime;
    this.sessionStats.lastRequestTime = responseTime;
    this.sessionStats.totalResponseTime += responseTime;
    this.sessionStats.apiCallsCount++;

    // 估算 token 使用（每个字符约 0.25 token）
    const inputTokens = Math.ceil(trimmed.length * 0.25);
    const outputTokens = result.success ? Math.ceil(result.finalResponse.length * 0.25) : 0;
    this.sessionStats.totalTokensUsed += inputTokens + outputTokens;

    if (result.success) {
      // 使用完整的对话历史（包含任务规划、工具调用结果等）
      if (result.messages && result.messages.length > 0) {
        // 提取文件操作記錄
        this.extractFileOperationsFromResult(result.messages);

        // 添加所有中间对话（任务规划、工具结果等）
        this.messages.push(...result.messages);
        this.sessionStats.messagesCount += result.messages.length;
      } else {
        // 降级方案：只保存最终回应
        this.messages.push({
          role: "assistant",
          content: result.finalResponse,
        });
        this.sessionStats.messagesCount++;
      }
      this.sessionStats.toolCallsCount += result.toolCallsExecuted;

      // 顯示 AI 回應面板
      const modelName = this.llmClient["model"] || "AI";
      console.log("\n" + createAssistantPanel(result.finalResponse, modelName));

      // 顯示統計資訊（根據複雜度選擇精簡版或完整版）
      if (this.sessionStats.toolCallsCount > 0) {
        // 有工具調用 - 顯示完整統計
        console.log(createStatsPanel({
          messagesCount: this.sessionStats.messagesCount,
          toolCallsCount: this.sessionStats.toolCallsCount,
          totalTokensUsed: this.sessionStats.totalTokensUsed,
          responseTime: this.sessionStats.lastRequestTime
        }));
      } else {
        // 簡單對話 - 顯示精簡統計
        console.log(createCompactStatsPanel({
          totalTokensUsed: this.sessionStats.totalTokensUsed,
          responseTime: this.sessionStats.lastRequestTime
        }));
      }
    } else {
      // 顯示錯誤面板
      console.log("\n" + createErrorPanel(result.error || "未知錯誤", "執行失敗"));
    }

    // AI 回應完成後恢復 readline 並顯示提示符
    this.rl.resume();
    this.rl.prompt();
  }

  /**
   * 处理多行输入
   */
  private async processMultiLineInput(input: string): Promise<void> {
    const trimmed = input.trim();
    
    // 保存到历史记录
    this.historyManager.add(trimmed);
    
    // 暫停 readline 以避免在處理期間顯示多餘的 prompt
    this.rl.pause();
    
    // 不支持多行斜线命令，直接作为普通输入处理
    
    // 將用戶消息加入歷史
    this.messages.push({
      role: "user",
      content: trimmed,
    });
    this.sessionStats.messagesCount++;

    // 记录开始时间
    const startTime = Date.now();

    // 使用 orchestrator 處理（支持工具調用，使用靜默模式避免重複輸出）
    const result = await this.orchestrator.run(this.messages, true, true);

    // 更新统计信息
    const responseTime = Date.now() - startTime;
    this.sessionStats.lastRequestTime = responseTime;
    this.sessionStats.totalResponseTime += responseTime;
    this.sessionStats.apiCallsCount++;
    
    // 估算 token 使用（每个字符约 0.25 token）
    const inputTokens = Math.ceil(trimmed.length * 0.25);
    const outputTokens = result.success ? Math.ceil(result.finalResponse.length * 0.25) : 0;
    this.sessionStats.totalTokensUsed += inputTokens + outputTokens;

    if (result.success) {
      // 將 assistant 回應加入歷史
      this.messages.push({
        role: "assistant",
        content: result.finalResponse,
      });
      this.sessionStats.messagesCount++;
      this.sessionStats.toolCallsCount += result.toolCallsExecuted;

      // 顯示 AI 回應面板
      const modelName = this.llmClient["model"] || "AI";
      console.log("\n" + createAssistantPanel(result.finalResponse, modelName));

      // 顯示統計資訊（根據複雜度選擇精簡版或完整版）
      if (this.sessionStats.toolCallsCount > 0) {
        // 有工具調用 - 顯示完整統計
        console.log(createStatsPanel({
          messagesCount: this.sessionStats.messagesCount,
          toolCallsCount: this.sessionStats.toolCallsCount,
          totalTokensUsed: this.sessionStats.totalTokensUsed,
          responseTime: this.sessionStats.lastRequestTime
        }));
      } else {
        // 簡單對話 - 顯示精簡統計
        console.log(createCompactStatsPanel({
          totalTokensUsed: this.sessionStats.totalTokensUsed,
          responseTime: this.sessionStats.lastRequestTime
        }));
      }
    } else {
      // 顯示錯誤面板
      console.log("\n" + createErrorPanel(result.error || "未知錯誤", "執行失敗"));
    }

    // AI 回應完成後恢復 readline 並顯示提示符
    this.rl.resume();
    this.rl.prompt();
  }

  /**
   * 处理粘贴输入
   */
  private async handlePastedInput(content: string): Promise<void> {
    const trimmed = content.trim();

    if (!trimmed) {
      return; // 不調用 rl.prompt() 避免意外激活輸入框
    }

    // 显示粘贴内容摘要
    const lines = content.split('\n');
    console.log(chalk.cyan(`\n📋 检测到粘贴内容:`));
    console.log(chalk.gray(`  • 总行数: ${lines.length}`));
    console.log(chalk.gray(`  • 字符数: ${content.length}`));

    // 预览前几行
    if (lines.length > 1) {
      console.log(chalk.yellow('\n预览:'));
      lines.slice(0, 5).forEach((line, i) => {
        const preview = line.length > 70 ? line.substring(0, 70) + '...' : line;
        console.log(chalk.gray(`  ${i + 1}. ${preview}`));
      });

      if (lines.length > 5) {
        console.log(chalk.gray(`  ... 还有 ${lines.length - 5} 行`));
      }
      console.log();
    }

    // 处理粘贴内容（作为单个请求）
    await this.processMultiLineInput(trimmed);
    // 不立即調用 rl.prompt()，讓 processMultiLineInput 自己處理
  }

  /**
   * 构建 System Prompt
   */
  private buildSystemPrompt(ctx: WorkspaceContext): string {
    // 获取环境上下文
    const osInfo = process.platform;
    const cwd = ctx.rootPath;

    // 注入 Git 状态
    const gitContext = ctx.gitStatus
      ? `当前分支: ${ctx.gitStatus.branch}\n变动文件:\n${ctx.gitStatus.changes.join('\n')}`
      : "Git状态: 未知/非Git仓库";

    // 注入短期记忆
    const recentFiles = ctx.recentFiles && ctx.recentFiles.length > 0
      ? `最近访问:\n- ${ctx.recentFiles.join('\n- ')}`
      : "最近访问: 无";

    // 检测可用的开发工具
    const availableTools = this.detectEnvironmentTools();

    return `# 白鹿 (Bailu) - AI 编程智能体

## 运行环境
- 系统: ${osInfo}
- 目录: ${cwd}
- 可用工具: ${availableTools}
- Git: ${gitContext}
- 记忆: ${recentFiles}

## 工具使用
你可以使用以下工具：
- list_directory: 列出目录内容
- read_file: 读取文件
- write_file: 写入文件
- run_command: 执行命令

## 重要规则
1. 必须先输出 <thought> 标签分析问题
2. 使用 XML 格式调用工具：<action><invoke tool="tool_name">...</invoke></action>
3. 直接行动，不要废话
4. 修改代码时必须提供完整内容
5. 遇到错误要明确说明并尝试修复

请用中文回复。`;
  }

  /**
   * 顯示歡迎信息
   */
  private printWelcome(): void {
    // ASCII Art Banner
    console.log(chalk.cyan(`
                                        ,--,                                          ,--,             
                                     ,---.'|                                       ,---.'|             
    ,---,.     ,---,           ,---, |   | :                             ,----..   |   | :       ,---, 
  ,'  .'  \\   '  .' \\       ,\`--.' | :   : |             ,--,           /   /   \\  :   : |    ,\`--.' | 
,---.' .' |  /  ;    '.     |   :  : |   ' :           ,'_ /|          |   :     : |   ' :    |   :  : 
|   |  |: | :  :       \\    :   |  ' ;   ; '      .--. |  | :          .   |  ;. / ;   ; '    :   |  ' 
:   :  :  / :  |   /\\   \\   |   :  | '   | |__  ,'_ /| :  . |          .   ; /--\`  '   | |__  |   :  | 
:   |    ;  |  :  ' ;.   :  '   '  ; |   | :.'| |  ' | |  . .          ;   | ;     |   | :.'| '   '  ; 
|   :     \\ |  |  ;/  \\   \\ |   |  | '   :    ; |  | ' |  | |          |   : |     '   :    ; |   |  | 
|   |   . | '  :  | \\  \\ ,' '   :  ; |   |  ./  :  | | :  ' ;          .   | '___  |   |  ./  '   :  ; 
'   :  '; | |  |  '  '--'   |   |  ' ;   : ;    |  ; ' |  | '          '   ; : .'| ;   : ;    |   |  ' 
|   |  | ;  |  :  :         '   :  | |   ,/     :  | : ;  ; |          '   | '/  : |   ,/     '   :  | 
|   :   /   |  | ,'         ;   |.'  '---'      '  :  \`--'   \\         |   :    /  '---'      ;   |.'  
|   | ,'    \`--''           '---'               :  ,      .-./          \\   \\ .'              '---'    
\`----'                                           \`--\`----'               \`---\`                         
    `));

    console.log(chalk.green("\n╔════════════════════════════════════════════════════╗"));
    console.log(chalk.green("║") + chalk.bold.cyan("      Bailu Chat - AI 交互模式                      ") + chalk.green("║"));
    console.log(chalk.green("╚════════════════════════════════════════════════════╝"));

    console.log(chalk.gray("\n💡 快速開始："));
    console.log(chalk.cyan("  • 直接輸入問題或需求，AI 會自動處理"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/") + chalk.cyan(" 顯示所有斜線命令（可用上下鍵選擇）"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/help") + chalk.cyan(" 查看命令說明"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/add <文件>") + chalk.cyan(" 添加文件到上下文"));
    console.log(chalk.cyan("  • 多行輸入：每行行尾加 ") + chalk.green("\\") + chalk.cyan(" 繼續，不加則提交"));
    console.log(chalk.yellow("  • 📋 貼上多行文字後，") + chalk.green("請按一次 Enter") + chalk.yellow(" 確保完整"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("exit") + chalk.cyan(" 退出"));

    const currentModel = this.llmClient["model"];
    const safetyMode = process.env.BAILU_MODE || "review";

    console.log(chalk.gray("\n⚙️  當前配置："));
    console.log(chalk.gray(`  模型: ${chalk.yellow(currentModel)}`));
    console.log(chalk.gray(`  模式: ${chalk.yellow(safetyMode)}`));
    console.log(chalk.gray(`  工作區: ${chalk.yellow(this.workspaceContext.rootPath)}`));
    console.log();
  }

  /**
   * 檢測環境中可用的開發工具
   * 用於告訴模型該用 python 還是 python3，npm 還是 yarn
   */
  private detectEnvironmentTools(): string {
    // 定義我們要檢查的常用工具列表
    const toolsToCheck = [
      'python', 'python3', 
      'pip', 'pip3', 
      'node', 'npm', 'yarn', 'pnpm',
      'git', 'docker', 
      'go', 'cargo', 'rustc', 
      'java', 'javac', 
      'gcc', 'clang', 'make'
    ];
    
    const availableTools: string[] = [];

    for (const tool of toolsToCheck) {
      try {
        // Windows 用 'where', Mac/Linux 用 'which'
        const checkCmd = process.platform === 'win32' ? `where ${tool}` : `which ${tool}`;
        
        // stdio: 'ignore' 防止命令輸出干擾終端
        execSync(checkCmd, { stdio: 'ignore' });
        availableTools.push(tool);
      } catch (e) {
        // 指令執行失敗代表工具不存在，忽略即可
      }
    }

    return availableTools.length > 0 ? availableTools.join(', ') : "未檢測到常用開發工具";
  }

  /**
   * 記錄文件訪問（在工具調用時自動更新）
   */
  private trackFileAccess(filepath: string): void {
    // 移除舊的記錄（如果存在）
    this.recentAccessedFiles = this.recentAccessedFiles.filter(f => f !== filepath);
    // 添加到最前面
    this.recentAccessedFiles.unshift(filepath);
    // 限制數量
    if (this.recentAccessedFiles.length > this.MAX_RECENT_FILES) {
      this.recentAccessedFiles = this.recentAccessedFiles.slice(0, this.MAX_RECENT_FILES);
    }
  }

  /**
   * 刷新工作區上下文（每次對話前調用）
   */
  private refreshWorkspaceContext(): void {
    this.workspaceContext = buildWorkspaceContext(
      this.workspaceContext.rootPath,
      this.recentAccessedFiles
    );
    
    // 更新 system message
    this.messages[0] = {
      role: "system",
      content: this.buildSystemPrompt(this.workspaceContext)
    };
  }

  /**
   * 從工具調用結果中提取文件操作
   * 簡化版：從 orchestrator 結果中的 messages 提取文件路徑
   */
  private extractFileOperationsFromResult(messages: ChatMessage[]): void {
    // 遍歷消息，查找包含文件路徑的工具調用
    messages.forEach(msg => {
      if (msg.role === "assistant" && msg.content) {
        // 嘗試從內容中提取 read_file 和 write_file 的路徑
        const readFileMatch = msg.content.match(/<invoke tool="read_file"><param name="path">([^<]+)<\/param>/g);
        const writeFileMatch = msg.content.match(/<invoke tool="write_file"><param name="path">([^<]+)<\/param>/g);
        
        if (readFileMatch) {
          readFileMatch.forEach(match => {
            const pathMatch = match.match(/<param name="path">([^<]+)<\/param>/);
            if (pathMatch && pathMatch[1]) {
              this.trackFileAccess(pathMatch[1]);
            }
          });
        }
        
        if (writeFileMatch) {
          writeFileMatch.forEach(match => {
            const pathMatch = match.match(/<param name="path">([^<]+)<\/param>/);
            if (pathMatch && pathMatch[1]) {
              this.trackFileAccess(pathMatch[1]);
            }
          });
        }
      }
    });
  }

  /**
   * 添加文件到上下文
   */
  public addFile(filepath: string): void {
    this.activeFiles.add(filepath);
    this.trackFileAccess(filepath);
  }

  /**
   * 从上下文移除文件
   */
  public removeFile(filepath: string): void {
    this.activeFiles.delete(filepath);
  }

  /**
   * 清空所有文件
   */
  public clearFiles(): void {
    this.activeFiles.clear();
  }

  /**
   * 获取所有活跃文件
   */
  public getActiveFiles(): string[] {
    return Array.from(this.activeFiles);
  }

  /**
   * 保存当前会话
   */
  public async saveCurrentSession(name?: string): Promise<string> {
    const sessionData: ChatSessionData = {
      sessionId: name
        ? this.sessionManager["sanitizeFilename"](name)
        : `session_${Date.now()}`,
      name,
      createdAt: this.sessionStats.startTime.toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      messages: this.messages,
      stats: {
        messagesCount: this.sessionStats.messagesCount,
        toolCallsCount: this.sessionStats.toolCallsCount,
        totalTokensUsed: this.sessionStats.totalTokensUsed,
        totalResponseTime: this.sessionStats.totalResponseTime,
        apiCallsCount: this.sessionStats.apiCallsCount,
        startTime: this.sessionStats.startTime.toISOString(),
      },
      activeFiles: Array.from(this.activeFiles),
    };

    if (name) {
      await this.sessionManager.saveSessionByName(sessionData, name);
    } else {
      await this.sessionManager.saveSession(sessionData);
    }

    return sessionData.sessionId;
  }

  /**
   * 加载会话
   */
  public async loadSession(sessionIdOrName: string): Promise<boolean> {
    const session = await this.sessionManager.loadSession(sessionIdOrName);
    if (!session) {
      return false;
    }

    // 恢复会话数据
    this.messages = session.messages;
    this.activeFiles = new Set(session.activeFiles);
    
    // 恢复统计信息
    this.sessionStats.messagesCount = session.stats.messagesCount;
    this.sessionStats.toolCallsCount = session.stats.toolCallsCount;
    this.sessionStats.totalTokensUsed = session.stats.totalTokensUsed;
    this.sessionStats.totalResponseTime = session.stats.totalResponseTime;
    this.sessionStats.apiCallsCount = session.stats.apiCallsCount;
    this.sessionStats.startTime = new Date(session.stats.startTime);

    return true;
  }

  /**
   * 列出所有会话
   */
  public async listSessions(): Promise<ChatSessionData[]> {
    return await this.sessionManager.listSessions();
  }

  /**
   * 删除会话
   */
  public async deleteSession(sessionIdOrName: string): Promise<boolean> {
    return await this.sessionManager.deleteSession(sessionIdOrName);
  }
}
