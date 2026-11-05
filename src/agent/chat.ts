/**
 * 交互式對話模式
 */

import chalk from "chalk";
import { GracefulExitError } from "../utils/graceful-exit.js";
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
import { createChatInput, ChatInput } from "../tui/chat-input.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { printWelcome } from "./chat-welcome.js";
import { PasteDetector } from "../utils/paste-detector.js";
import { gatherContextWithProgress } from "./auto-context.js";
import { 
  createUserPanel, 
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
  private input: ChatInput;
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
  private currentSessionId: string = `session_${Date.now()}`; // 當前會話 ID
  private autoSaveTimer: NodeJS.Timeout | null = null; // 自動保存計時器
  private readonly AUTO_SAVE_INTERVAL_MS = 60 * 1000; // 每 60 秒自動保存
  private hasUnsavedChanges: boolean = false; // 是否有未保存的更改
  private isProcessing: boolean = false; // 是否正在處理一個回合
  private pendingInputs: string[] = []; // 處理中排隊的訊息（Claude Code 風格）
  private abortController: AbortController | null = null; // 當前回合的中斷控制器
  private processingListener: ((chunk: Buffer) => void) | null = null; // 處理期間的按鍵監聽
  private savedRawMode: boolean = false; // 進入處理狀態前的 raw mode
  private typingBuffer: string = ''; // 處理期間用戶正在打的字
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
      maxIterations: 50,
      verbose: false, // chat 模式下默認不顯示詳細執行信息
    });

    // 初始化對話歷史（帶 system prompt）
    this.messages = [
      {
        role: "system",
        content: buildSystemPrompt(options.workspaceContext),
      },
    ];

    // 初始化历史记录管理器
    this.historyManager = new HistoryManager(getHistoryPath());

    // 初始化会话管理器
    this.sessionManager = new ChatSessionManager();

    this.input = createChatInput("You: ", []);

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
    printWelcome(this.llmClient, this.workspaceContext);
    
    // 啟動自動保存計時器
    this.startAutoSave();

    // Ctrl+C 处理：第一次提示，第二次（3秒内）退出
    let lastSigintTime: number | null = null;
    process.on('SIGINT', async () => {
      const now = Date.now();

      if (lastSigintTime && (now - lastSigintTime) < 3000) {
        // 3秒内第二次 Ctrl+C，退出前自動保存
        await this.autoSaveOnExit();
        this.pasteDetector.destroy();
        this.stopAutoSave();
        console.log(chalk.gray("\n\n再見！"));
        this.input.close();
        throw new GracefulExitError();
      } else {
        // 第一次 Ctrl+C，提示
        console.log(chalk.yellow("\n\n[提示] 再按一次 Ctrl+C (3秒内) 退出，或輸入 'exit' 退出"));
        lastSigintTime = now;
        this.input.resume();
      }
    });

    this.input.resume();

    this.input.onSubmit((input) => {
      // 修復 Windows 終端重複回顯：readline + conpty 各回顯一次
      // 清除當前行的重複文字
      if (process.platform === 'win32') {
        process.stdout.write(this.ANSI_CARRIAGE_RETURN + this.ANSI_CLEAR_LINE);
      }
      // 使用粘贴检测器处理所有输入
      this.pasteDetector.push(input);
    });

    this.input.onClose(() => {
      this.pasteDetector.destroy();
    });
  }

  /**
   * 啟動自動保存計時器
   */
  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(async () => {
      if (this.hasUnsavedChanges && this.messages.length > 1) {
        try {
          await this.saveCurrentSession(this.currentSessionId);
          this.hasUnsavedChanges = false;
          // 靜默保存，不打斷用戶
        } catch (error) {
          // 自動保存失敗不影響正常使用
        }
      }
    }, this.AUTO_SAVE_INTERVAL_MS);
  }

  /**
   * 停止自動保存計時器
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 退出時自動保存
   */
  private async autoSaveOnExit(): Promise<void> {
    if (this.messages.length > 1) { // 有對話內容
      try {
        await this.saveCurrentSession(this.currentSessionId);
        console.log(chalk.gray(`💾 對話已自動保存`));
      } catch (error) {
        // 保存失敗不影響退出
      }
    }
  }

  /**
   * 标记有未保存的更改
   */
  private markUnsaved(): void {
    this.hasUnsavedChanges = true;
  }

  /**
   * 处理单行输入
   */
  private async handleSingleLine(input: string): Promise<void> {
    // 處理中：新輸入排隊（Claude Code 風格訊息佇列）
    if (this.isProcessing) {
      const t = input.trim();
      if (t) {
        this.pendingInputs.push(t);
        console.log(chalk.gray(`\n[已排隊] 將在當前回合結束後處理（共 ${this.pendingInputs.length} 則）`));
      }
      return;
    }

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
        if (!this.input.isTui) (this.input as any).setPrompt?.(chalk.cyan("\n你: "));

        if (fullInput.trim()) {
          await this.processMultiLineInput(fullInput);
        }
        this.input.resume();
        return;
      }

      // 检查当前行是否以 \ 结尾（续行）
      if (input.endsWith('\\')) {
        // 继续多行模式
        this.multiLineBuffer.push(input.slice(0, -1)); // 移除末尾的 \
        if (!this.input.isTui) (this.input as any).setPrompt?.(chalk.gray("  ... "));
        this.input.resume();
        return;
      } else {
        // 没有 \，这是最后一行，结束并提交
        this.multiLineBuffer.push(input);
        const fullInput = this.multiLineBuffer.join('\n');
        this.isMultiLineMode = false;
        this.multiLineBuffer = [];
        if (!this.input.isTui) (this.input as any).setPrompt?.(chalk.bold.cyan("\nYou: "));

        if (fullInput.trim()) {
          // 处理多行输入
          await this.processMultiLineInput(fullInput);
        }
        this.input.resume();
        return;
      }
    }

    // 单行模式
    const trimmed = input.trim();

    if (!trimmed) {
      this.input.resume();
      return;
    }

    // 检查行尾是否有续行符 \
    if (input.endsWith('\\')) {
      // 进入多行模式
      this.isMultiLineMode = true;
      this.multiLineBuffer = [input.slice(0, -1)]; // 移除末尾的 \
      if (!this.input.isTui) (this.input as any).setPrompt?.(chalk.gray("  ... "));
      this.input.resume();
      return;
    }

    // 保存到历史记录
    this.historyManager.add(trimmed);

    // 暫停 readline 以避免在處理期間顯示多餘的 prompt
    this.input.pause();

    // 舊的特殊命令（保持向後兼容）
    if (trimmed === "exit" || trimmed === "quit") {
      await this.autoSaveOnExit();
      this.stopAutoSave();
      console.log(chalk.gray("再見！"));
      this.pasteDetector.destroy();
      this.input.close();
      throw new GracefulExitError();
    }

    if (trimmed === "clear") {
      this.messages = [this.messages[0]]; // 保留 system message
      this.sessionStats.messagesCount = 0;
      console.log(chalk.green("✓ 對話歷史已清空"));
      this.input.resume();
      this.input.resume();
      return;
    }

    // 處理斜線命令
    if (trimmed.startsWith("/")) {
      // 如果只輸入了 /，顯示命令選擇器
      if (trimmed === "/") {
        // TUI 模式：掛起輸入框，讓選擇器獨佔終端
        const tui = this.input.isTui ? (this.input as import("../tui/chat-input.js").TuiInput) : null;
        tui?.suspend();

        let selectedCommand: string | null;
        try {
          selectedCommand = await showSlashCommandPicker('/');
        } finally {
          tui?.restore();
        }

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
              await this.autoSaveOnExit();
              this.stopAutoSave();
              console.log(chalk.gray("再見！"));
              this.pasteDetector.destroy();
              this.input.close();
              throw new GracefulExitError();
            }

            if (result.shouldClearHistory) {
              this.messages = [this.messages[0]];
              this.sessionStats.messagesCount = 0;
            }
          }
        }

        // 恢复 readline（自寫選擇器已自行清理 stdin 狀態）
        this.input.resume();
        this.input.resume();

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
          this.markUnsaved();
        }

        if (slashResult.shouldExit) {
          await this.autoSaveOnExit();
          this.stopAutoSave();
          console.log(chalk.gray("再見！"));
          this.pasteDetector.destroy();
          this.input.close();
          throw new GracefulExitError();
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

      // 同步安全模式到執行器（/mode 命令只改環境變數，這裡真正生效）
      this.orchestrator.updateSafetyMode(
        (process.env.BAILU_MODE as ToolExecutionContext["safetyMode"]) || "review"
      );

      this.input.resume();
      this.input.resume();
      return;
    }

    // 核心處理：自動上下文 + orchestrator + 統計（含 Esc 中斷與排隊支援）
    await this.processUserInput(trimmed);

    // AI 回應完成後恢復 readline 並顯示提示符
    this.input.resume();
    this.input.resume();

    // 處理排隊的訊息
    await this.drainPendingInputs();
  }

  /**
   * 處理排隊的訊息（當前回合結束後依序送出）
   */
  private async drainPendingInputs(): Promise<void> {
    while (this.pendingInputs.length > 0) {
      const next = this.pendingInputs.shift()!;
      console.log(chalk.cyan(`\n[處理排隊訊息] ${next.substring(0, 50)}${next.length > 50 ? '...' : ''}`));
      await this.handleSingleLine(next);
    }
  }

  /**
   * 處理期間的按鍵監聽：Esc/Ctrl+C 中斷當前回合，打字即時回顯並排隊
   */
  private installProcessingListener(): void {
    if (!process.stdin.isTTY) return;

    this.savedRawMode = process.stdin.isRaw ?? false;
    try {
      process.stdin.setRawMode(true);
    } catch {
      return;
    }
    this.typingBuffer = '';

    this.processingListener = (chunk: Buffer) => {
      const s = chunk.toString();

      // Esc（單獨的轉義字節）或 Ctrl+C：中斷當前回合
      if (s === '\u001b' || s === '\u0003') {
        this.abortController?.abort();
        return;
      }

      // 其餘按鍵：迷你行編輯（回顯 + 退格 + Enter 排隊）
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          const line = this.typingBuffer.trim();
          this.typingBuffer = '';
          if (line) {
            this.pendingInputs.push(line);
            console.log(chalk.gray(`\n[已排隊] ${line.substring(0, 40)}${line.length > 40 ? '...' : ''}（共 ${this.pendingInputs.length} 則）`));
          }
        } else if (ch === '\u007f' || ch === '\b') {
          if (this.typingBuffer.length > 0) {
            this.typingBuffer = this.typingBuffer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          this.typingBuffer += ch;
          process.stdout.write(ch);
        }
      }
    };

    process.stdin.on('data', this.processingListener);
  }

  /** 移除處理期間的按鍵監聽，恢復終端狀態 */
  private removeProcessingListener(): void {
    if (!this.processingListener) return;

    process.stdin.removeListener('data', this.processingListener);
    this.processingListener = null;
    try {
      process.stdin.setRawMode(this.savedRawMode);
    } catch {
      // ignore
    }

    // 未提交的半行輸入轉入佇列，避免丟失
    if (this.typingBuffer.trim()) {
      this.pendingInputs.push(this.typingBuffer.trim());
      this.typingBuffer = '';
      console.log();
    }
  }

  /**
   * 核心處理流程：自動上下文 → orchestrator（可中斷）→ 統計顯示
   */
  private async processUserInput(trimmed: string): Promise<void> {
    this.isProcessing = true;
    this.abortController = new AbortController();

    // TUI 模式：InputBox 原生支援 Esc 中斷與排隊（Enter 提交由 isProcessing 排隊）
    // readline 模式：安裝臨時按鍵監聽
    if (this.input.isTui) {
      this.input.pause(); // 框顯示「處理中」狀態，仍可打字
      this.input.onInterrupt?.(() => this.abortController?.abort());
    } else {
      this.installProcessingListener();
    }
    console.log(chalk.gray(`[處理中] Esc = 中斷本輪，直接打字 = 排隊訊息`));

    try {
      // 刷新工作區上下文（更新 Git 狀態和最近文件）
      this.refreshWorkspaceContext();

      // 自動蒐集相關代碼上下文（類似 Cursor IDE）
      const autoContext = await gatherContextWithProgress(
        trimmed,
        this.workspaceContext.rootPath,
        this.recentAccessedFiles,
      );

      // 將用戶消息加入歷史（附帶自動蒐集的上下文）
      const userContent = autoContext.hasContext
        ? `${trimmed}\n\n${autoContext.contextText}`
        : trimmed;
      this.messages.push({
        role: "user",
        content: userContent,
      });
      this.sessionStats.messagesCount++;
      this.markUnsaved();

      // 记录开始时间
      const startTime = Date.now();

      // 使用 orchestrator 處理（支持工具調用，流式輸出，可被 Esc 中斷）
      const result = await this.orchestrator.run(
        this.messages,
        true,
        false,
        this.abortController.signal
      );

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

          // 添加所有中间对话（任务规划、工具结果等，不含呼叫前已有的訊息）
          this.messages.push(...result.messages);
          this.sessionStats.messagesCount += result.messages.length;
        } else if (result.finalResponse) {
          // 降级方案：只保存最终回应
          this.messages.push({
            role: "assistant",
            content: result.finalResponse,
          });
          this.sessionStats.messagesCount++;
        }
        this.sessionStats.toolCallsCount += result.toolCallsExecuted;
        this.markUnsaved();

        // 中斷提示
        if (result.interrupted) {
          console.log(chalk.yellow("（回應已保留部分內容，可直接繼續對話）"));
        }

        // 顯示統計資訊（根據複雜度選擇精簡版或完整版）
        if (this.sessionStats.toolCallsCount > 0) {
          console.log(createStatsPanel({
            messagesCount: this.sessionStats.messagesCount,
            toolCallsCount: this.sessionStats.toolCallsCount,
            totalTokensUsed: this.sessionStats.totalTokensUsed,
            responseTime: this.sessionStats.lastRequestTime
          }));
        } else {
          console.log(createCompactStatsPanel({
            totalTokensUsed: this.sessionStats.totalTokensUsed,
            responseTime: this.sessionStats.lastRequestTime
          }));
        }
      } else {
        // 顯示錯誤面板
        console.log("\n" + createErrorPanel(result.error || "未知錯誤", "執行失敗"));
      }
    } finally {
      if (!this.input.isTui) {
        this.removeProcessingListener();
      } else {
        this.input.resume(); // 框回到「You」狀態
      }
      this.abortController = null;
      this.isProcessing = false;
    }
  }

  /**
   * 处理多行输入
   */
  private async processMultiLineInput(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    // 保存到历史记录
    this.historyManager.add(trimmed);

    // 處理中：排隊
    if (this.isProcessing) {
      this.pendingInputs.push(trimmed);
      console.log(chalk.gray(`\n[已排隊] 將在當前回合結束後處理（共 ${this.pendingInputs.length} 則）`));
      return;
    }

    // 暫停 readline 以避免在處理期間顯示多餘的 prompt
    this.input.pause();

    // 不支持多行斜线命令，直接作为普通输入处理
    // 核心處理與單行輸入一致（含 Esc 中斷與排隊）
    await this.processUserInput(trimmed);

    // AI 回應完成後恢復 readline 並顯示提示符
    this.input.resume();
    this.input.resume();

    // 處理排隊的訊息
    await this.drainPendingInputs();
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

  /**

  /**

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
      content: buildSystemPrompt(this.workspaceContext)
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
        : this.currentSessionId,
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

    this.hasUnsavedChanges = false;
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
    this.currentSessionId = session.sessionId;
    
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
