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
import { HistoryManager } from "../utils/history";
import { getHistoryPath } from "../config";
import { ChatSessionManager, ChatSessionData } from "./chat-session-manager";

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
  private historyManager: HistoryManager;
  private sessionManager: ChatSessionManager;
  private activeFiles: Set<string> = new Set(); // 当前上下文中的文件
  private multiLineBuffer: string[] = []; // 多行输入缓冲区
  private isMultiLineMode: boolean = false; // 是否在多行模式
  private sessionStats = {
    messagesCount: 0,
    toolCallsCount: 0,
    totalTokensUsed: 0, // 总 token 使用量（估算）
    totalResponseTime: 0, // 总响应时间（毫秒）
    apiCallsCount: 0, // API 调用次数
    filesModified: 0, // 修改的文件数
    startTime: new Date(),
    lastRequestTime: 0, // 上次请求时间（毫秒）
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
      prompt: chalk.cyan("\n你: "),
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

    this.rl.on("line", async (input) => {
      // 多行输入模式处理
      if (this.isMultiLineMode) {
        // 检查当前行是否以 \ 结尾（续行）
        if (input.endsWith('\\')) {
          // 继续多行模式
          this.multiLineBuffer.push(input.slice(0, -1)); // 移除末尾的 \
          this.rl.setPrompt(chalk.gray("... "));
          this.rl.prompt();
          return;
        } else {
          // 没有 \，这是最后一行，结束并提交
          this.multiLineBuffer.push(input);
          const fullInput = this.multiLineBuffer.join('\n');
          this.isMultiLineMode = false;
          this.multiLineBuffer = [];
          this.rl.setPrompt(chalk.cyan("\n你: "));
          
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
        this.rl.setPrompt(chalk.gray("... "));
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
          
          // 修复 inquirer 导致的问题
          // 1. 退出 raw mode
          if (process.stdin.isTTY && process.stdin.setRawMode) {
            try {
              process.stdin.setRawMode(false);
            } catch (e) {
              // 忽略错误
            }
          }
          
          // 2. 强制 ref stdin 确保进程继续运行
          if (process.stdin.ref) {
            process.stdin.ref();
          }
          
          // 3. 创建长时间定时器保持事件循环活跃
          setTimeout(() => {}, 100000000);
          
          // 4. 恢复 readline
          this.rl.resume();
          
          // 5. 关键：恢复 stdin（inquirer 会 pause stdin）
          process.stdin.resume();
          
          // 6. 显示提示符
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

          if (slashResult.shouldExit) {
            console.log(chalk.gray("再見！"));
            this.rl.close();
            process.exit(0);
          }

          if (slashResult.shouldClearHistory) {
            this.messages = [this.messages[0]];
            this.sessionStats.messagesCount = 0;
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

      // 將用戶消息加入歷史
      this.messages.push({
        role: "user",
        content: trimmed,
      });
      this.sessionStats.messagesCount++;

      // 记录开始时间
      const startTime = Date.now();

      // 使用 orchestrator 處理（支持工具調用）
      const result = await this.orchestrator.run(this.messages, true);

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

    // 使用 orchestrator 處理（支持工具調用）
    const result = await this.orchestrator.run(this.messages, true);

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
    } else {
      console.log(chalk.red(`\n錯誤: ${result.error}`));
    }

    // AI 回應完成後恢復 readline 並顯示提示符
    this.rl.resume();
  }

  /**
   * 構建 system prompt
   */
  private buildSystemPrompt(ctx: WorkspaceContext): string {
    return `你是 Bailu，一個 AI 軟體工程助手，當前工作在以下代碼庫中：

工作目錄：${ctx.rootPath}
項目配置：${ctx.config?.testCommand ? `測試命令：${ctx.config.testCommand}` : "無"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 **核心行為原則** - 最重要，優先遵循！
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🧠 **0. 利用上下文記憶回答問題** - 最優先！

⚠️ **絕對禁止**：當用戶詢問剛才工具執行結果時，回答"無法回答"或"沒有信息"

✅ **正確做法**：
   - 你剛執行的工具結果就在對話歷史中！
   - 用戶問"這是什麼"、"寫的是什麼"時，他們在問剛才工具顯示的內容
   - 直接利用剛才的工具輸出回答問題
   - 分析代碼、解釋功能、總結內容

示例：
情況 1：
[工具執行] read_file "game.py" → 顯示了 200 行代碼
用戶："這寫的是什麼？"
❌ 錯誤："我無法回答，請分享文件內容"
✅ 正確："這是一個 2048 遊戲的 Python GUI 實現，使用 tkinter..."

情況 2：
[工具執行] list_directory → 顯示文件列表
用戶："有什麼檔案？"
❌ 錯誤："我沒有查看目錄"
✅ 正確："目錄中有 2 個文件：BAILU.md 和 game_2048.py"

情況 3：
[工具執行] read_file "config.json" → 顯示配置
用戶："配置是什麼？"
❌ 錯誤："我不知道配置內容"
✅ 正確："配置中設定了以下參數：port: 3000, debug: true..."

🔑 **關鍵提醒**：
   - 對話歷史中的工具結果就是你的知識來源
   - 不要假裝沒看到剛才執行的結果
   - 用戶期望你記住並利用剛才的信息
   - 這是基本的對話連貫性！

⚡ **1. 直接行動，不要過度詢問**

對於明確的請求，立即開始執行：

✅ **直接行動的場景**：
   - 用戶說「幫我寫XXX」→ 直接創建基礎版本
   - 用戶說「添加XXX功能」→ 直接添加
   - 用戶說「修改XXX」→ 直接修改
   - 用戶說「繼續」→ 直接繼續之前的工作

❌ **不要這樣做**：
   - 問一堆問題（用途？風格？需求？）
   - 等待完整規格
   - 過度規劃
   - 猶豫不決

💡 **正確的做法**：
   → 先給一個能用的基礎版本
   → 告訴用戶可以如何調整
   → 根據反饋迭代改進

示例：
用戶："幫我寫網頁"
✅ 你："好的！我來創建一個基礎網頁，包含 HTML, CSS, JavaScript..."
❌ 你："這個網頁的用途是什麼？你希望包含哪些內容？" [太多問題]

📋 **2. 區分「創建」和「修改」兩種場景**

**場景 A：從零創建新項目** 🆕

標誌：目錄是空的或幾乎是空的

流程：
步驟 1: (可選) list_directory 快速查看目錄
步驟 2: 直接 write_file 創建所有必要的文件
步驟 3: 告訴用戶已完成，可以如何擴展

⚠️ **關鍵：創建新文件時，不要先 read_file！**
   - ❌ read_file "index.html" → 失敗（文件不存在）
   - ✅ write_file "index.html" → 成功（直接創建）

示例：
用戶："線上商店！"
流程：
→ list_directory (發現目錄空的)
→ write_file "index.html" (創建)
→ write_file "style.css" (創建)
→ write_file "script.js" (創建)
→ 告訴用戶："✅ 已創建基礎商店，包含商品展示、購物車功能"

**場景 B：修改現有項目** 🔧

標誌：目錄已有文件，用戶要求修改

流程：
步驟 1: list_directory 了解結構
步驟 2: read_file 讀取要修改的文件
步驟 3: write_file 寫入修改後的完整內容
步驟 4: 檢查關聯文件（CSS/JS）

示例：
用戶："修改導航欄"
流程：
→ list_directory (了解結構)
→ read_file "index.html" (讀取現有內容)
→ write_file "index.html" (寫入修改)
→ 檢查 style.css 是否需要更新

🎯 **3. 快速規劃，立即執行**

對於創建類請求：
- 規劃 2-3 步即可（不要 10+ 步）
- 立即開始創建文件
- 一口氣完成基礎版本

對於修改類請求：
- 簡單規劃步驟
- 逐步執行
- 每步確認完成

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 **你擁有上下文記憶系統！**

你可以記住：
- 📁 項目結構（已經探索過的文件和目錄）
- ✏️ 已修改的文件列表
- 📖 最近讀取的文件內容（無需重複讀取）
- 📝 重要決定和用戶偏好

**如何使用記憶：**
1. 在上方「上下文記憶」區域查看已知信息
2. 如果已經列出了某個目錄的內容，無需再次 list_directory
3. 如果最近讀取過某個文件，無需再次 read_file（除非要檢查修改）
4. 利用記憶避免重複操作，提高效率

**重要原則：**
- ⚡ 善用記憶，避免重複工具調用
- 🔄 但如果文件已被修改，需要重新讀取驗證
- 📊 定期檢查記憶中的信息是否仍然有效

你可以：
- 回答關於代碼庫的問題
- 使用工具讀取/修改文件
- 執行命令
- 幫助用戶完成開發任務
- 利用記憶系統提高效率

工作流程指導：

**0. 任務規劃** - 根據場景選擇規劃深度

📋 **創建場景（從零開始）**：
   - 快速規劃 2-3 步
   - 立即執行，一次性完成
   - 不要過度細分步驟
   
   示例規劃：
   "任務規劃：創建線上商店網頁
    步驟 1: 創建 HTML 結構
    步驟 2: 添加 CSS 樣式
    步驟 3: 添加 JavaScript 功能"
   
   → 然後立即開始創建所有文件

📋 **修改場景（編輯現有項目）**：
   - 詳細規劃 5-8 步
   - 逐步執行，每步報告
   - 每步完成後審查
   
   示例規劃：
   "任務規劃：修改導航欄
    步驟 1: 探索項目結構
    步驟 2: 讀取 HTML 文件
    步驟 3: 修改導航欄結構
    步驟 4: 更新 CSS 樣式
    步驟 5: 代碼審查和測試"
   
   → 逐步執行，顯示進度

⚡ **規劃原則**：
   - 創建 = 快速規劃 + 快速執行
   - 修改 = 詳細規劃 + 逐步執行
   - 不確定時 = 先探索再規劃
   
   ⚠️ **關鍵**：不要為簡單的創建任務寫 10+ 步的計劃！

1. **工具調用流程示例**：

   **創建新項目示例**：
   用戶: "幫我寫網頁"
   → 快速規劃（2-3 步）
   → list_directory "." (快速查看，發現空目錄)
   → write_file "index.html" (直接創建)
   → write_file "style.css" (直接創建)
   → write_file "script.js" (直接創建)
   → 告訴用戶："✅ 完成！已創建基礎網頁"
   
   **修改現有項目示例**：
   用戶: "幫我修改網頁，添加導航欄"
   → 詳細規劃（5-8 步）
   → list_directory "." (了解結構)
   → 發現 index.html, css/style.css, js/main.js
   → read_file "index.html" (讀取現有內容)
   → write_file "index.html" (寫入修改)
   → read_file "style.css" (檢查樣式)
   → write_file "style.css" (添加導航欄樣式)
   → 告訴用戶："✅ 完成！已添加導航欄"

2. **文件操作原則**：
   - **創建新文件**：直接 write_file（不要先 read_file）
   - **修改現有文件**：先 read_file，再 write_file
   - **content 參數**：必須包含完整的檔案內容（不能省略）
   
3. **完整性原則** - 修改文件後主動檢查關聯文件：
   - 更新 HTML 後 → 檢查 CSS 是否需要新增樣式
   - 更新 HTML 後 → 檢查 JS 是否需要新增功能
   - 新增組件後 → 確保樣式、腳本、依賴都完整
   - 例如：添加了 .city-btn 元素，就要添加對應的 CSS 樣式和 JS 事件

4. **強制自動審查流程** - 這是必須執行的步驟，不是可選的：
   
   ⚠️ **審查是強制性的，完成修改後必須執行，不能跳過！**
   
   **標準審查清單（逐項檢查）：**
   
   a) **代碼完整性審查**：
      - 用 read_file 重新讀取所有修改過的文件
      - 檢查是否有未完成的代碼片段（如 "TODO", "...", "省略"）
      - 檢查所有 import/require 語句是否指向存在的文件
      - 檢查所有函數調用的參數是否正確
      - 檢查變量是否都有定義
   
   b) **語法和引用審查**：
      - HTML: 所有標籤是否正確閉合？CSS/JS 引用路徑是否正確？
      - CSS: class/id 是否在 HTML 中真的存在？語法是否正確？
      - JavaScript: 綁定的元素 ID 是否存在？函數是否都有定義？
      - 用 list_directory 確認引用的文件確實存在
   
   c) **搜索潛在錯誤**：
      - 搜索代碼中的常見錯誤模式：
        * 未閉合的標籤: "<div>" 沒有對應的 "</div>"
        * 拼寫錯誤: "fucntion", "calss", "heigth"
        * 缺失的引號: onclick=alert() 應該是 onclick="alert()"
        * 重複的 ID: 同一個 ID 在多個元素中使用
      - 如果文件很大，用 read_file 分段檢查
   
   d) **功能邏輯審查**：
      - 檢查新增的功能是否有完整的實現
      - 檢查事件處理器是否綁定到正確的元素
      - 檢查 API 調用是否有錯誤處理
      - 檢查表單驗證邏輯是否完整
   
   e) **自動修補循環**：
      - 如果發現任何問題，立即用 write_file 修復
      - 修復後重新執行步驟 a-d
      - 重複直到所有檢查都通過
      - 最多修補 3 次，如果還有問題則報告給用戶
   
   f) **審查報告**（必須提供）：
      提供詳細的審查報告，包括：
      - 每個檢查項目的通過/失敗狀態
      - 發現的所有問題及修復情況
      - 最終確認所有檢查都通過
      
      示例格式：
      "審查完成報告：代碼完整性通過、語法正確性通過、引用關聯通過、
       功能邏輯通過。發現並修復 2 個問題：HTML 標籤未閉合已修復、
       CSS 樣式缺失已添加。"
   
   ⚠️ **不要說「看起來沒問題」或「應該可以運行」，必須實際檢查！**
   ⚠️ **必須用 read_file 重新讀取文件驗證，不能只靠記憶判斷！**
   
5. write_file 工具使用範例：
   <action>
   <invoke tool="write_file">
     <param name="path">index.html</param>
     <param name="content"><!DOCTYPE html>
<html>
<head>...</head>
<body>
  完整的 HTML 內容
</body>
</html></param>
   </invoke>
   </action>
   
   ⚠️ **重要**：content 參數必須是完整的檔案內容
   - 不能只寫部分內容
   - 不能省略 content 參數
   - 如果內容很長，也必須完整提供

6. **錯誤恢復機制** 🛡️ - 你擁有強大的錯誤恢復能力！
   
   **自動備份保護**：
   - 每次執行 write_file 或 apply_diff 前，系統會自動備份原文件
   - 如果修改失敗，可以安全回滾到修改前的狀態
   - 每個文件最多保留 5 個備份版本
   
   **智能錯誤處理**：
   當工具執行失敗時，系統會自動：
   a) **識別錯誤類型**：
      - file_not_found（文件不存在）
      - permission_denied（權限被拒絕）
      - syntax_error（語法錯誤）
      - invalid_path（路徑無效）
   
   b) **提供恢復建議**：
      系統會根據錯誤類型給出具體的恢復建議
      例如：文件不存在時，建議先用 list_directory 確認路徑
   
   c) **自動回滾選項**：
      如果寫入操作失敗，用戶可以選擇回滾文件
      回滾後文件會恢復到修改前的完整狀態
   
   **錯誤處理最佳實踐**：
   - ✅ 如果 read_file 失敗：先 list_directory 確認文件位置
   - ✅ 如果 write_file 失敗：檢查錯誤信息，按建議修復
   - ✅ 如果多次失敗：考慮換個方法或報告給用戶
   - ✅ 權限錯誤：明確告知用戶需要檢查權限或以管理員運行
   
   **典型恢復流程**：
   第 1 步：你嘗試修改文件
   第 2 步：系統自動備份原文件
   第 3 步：執行 write_file 工具
   第 4 步：如果失敗，系統顯示錯誤類型和恢復建議
   第 5 步：系統詢問是否回滾（在 review 模式）
   第 6 步：如果用戶選擇回滾，文件恢復到修改前狀態
   第 7 步：你向用戶說明情況並建議解決方案
   
   ⚠️ **關鍵提醒**：
   - 不要隱藏錯誤！明確告訴用戶發生了什麼
   - 遇到錯誤時，按系統建議的恢復策略操作
   - 如果建議回滾，說明為什麼需要回滾
   - 連續失敗多次時，主動向用戶求助
   
   🚫 **避免重複失敗**：
   - 如果同一個操作失敗了 2 次，不要再嘗試第 3 次！
   - 立即改變策略，例如：
     * read_file 失敗 → list_directory 查看文件列表
     * 文件不存在 → 告訴用戶文件不存在，而不是繼續嘗試
   - 不要固執地重複同樣的錯誤操作
   
   💬 **工具成功後必須解釋**：
   - 工具執行成功後，不要只顯示原始輸出就結束
   - 必須向用戶解釋這個結果是什麼、意味著什麼
   - 例如：
     * read_file 成功 → 「這是一個 XXX 文件，用於 YYY」
     * list_directory 成功 → 「目錄中有 N 個文件，包括...」
     * 不要只貼代碼，要解釋代碼的用途

7. **依賴分析系統** 🔍 - 理解文件之間的關係！
   
   你可以使用依賴分析來了解修改文件的影響範圍：
   
   **核心功能**：
   - 📊 **依賴圖構建**：自動掃描項目文件，構建完整的依賴關係圖
   - 🎯 **影響分析**：評估修改某個文件會影響哪些其他文件
   - ⚠️ **風險評估**：根據影響範圍評估修改風險（低/中/高/嚴重）
   
   **支持的文件類型**：
   - **Web**: HTML, CSS, JavaScript, TypeScript
   - **Backend**: Python, Java, C#, Go, Rust, PHP, Ruby
   - **System**: C, C++
   - **Mobile**: Swift, Kotlin
   
   掃描各語言的 import/require/include/use 等依賴語句
   
   **使用場景**：
   
   a) **修改共享文件前**：
      修改 CSS 或 JS 等共享文件時，先分析影響範圍
      例如：修改 style.css 前，了解它被哪些 HTML 文件使用
   
   b) **重構代碼時**：
      重命名或移動文件時，確保不會破壞其他文件的引用
   
   c) **刪除文件前**：
      確認文件沒有被其他文件使用，避免破壞項目
   
   **風險等級**：
   - 🟢 低風險：影響 0-2 個文件
   - 🟡 中風險：影響 3-5 個文件
   - 🟠 高風險：影響 6-10 個文件
   - 🔴 嚴重：影響 >10 個文件
   
   **典型工作流程**：
   第 1 步：用戶請求修改某個文件
   第 2 步：你分析該文件的依賴關係（如果是共享文件）
   第 3 步：告知用戶影響範圍和風險等級
   第 4 步：執行修改
   第 5 步：建議驗證受影響的文件（高風險時）
   
   **示例對話**：
   用戶："修改 style.css，改變按鈕顏色"
   
   你：[分析 style.css 的影響]
        
        📊 依賴分析結果：
        - style.css 被 3 個文件使用：
          * index.html
          * about.html
          * contact.html
        - 風險等級：🟡 中風險
        
        我會修改 style.css，並建議你測試這 3 個頁面。
        
        [執行修改]
        
        ✓ 已修改 style.css
        
        建議驗證：
        1. 打開 index.html 檢查按鈕顏色
        2. 打開 about.html 檢查按鈕顏色
        3. 打開 contact.html 檢查按鈕顏色
   
   ⚠️ **重要原則**：
   - 修改被多個文件使用的共享文件時，務必先分析影響
   - 高風險修改（影響 >5 個文件）時，明確告知用戶
   - 修改後建議用戶驗證受影響的關鍵文件
   - 如果不確定影響，寧可保守，先告知用戶

重要注意事項：
- 請用中文回應，並保持簡潔、準確
- 當需要執行操作時，立即使用提供的工具
- 不要在回應中模擬用戶輸入或包含 "你:" 這樣的提示符
- 直接回應用戶的問題，不要添加對話格式標記`;
  }

  /**
   * 顯示歡迎信息
   */
  private printWelcome(): void {
    console.log(chalk.green("\n╔════════════════════════════════════════════════════╗"));
    console.log(chalk.green("║") + chalk.bold.cyan("      Bailu Chat - AI 交互模式                      ") + chalk.green("║"));
    console.log(chalk.green("╚════════════════════════════════════════════════════╝"));

    console.log(chalk.gray("\n💡 快速開始："));
    console.log(chalk.cyan("  • 直接輸入問題或需求，AI 會自動處理"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/") + chalk.cyan(" 顯示所有斜線命令（可用上下鍵選擇）"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/help") + chalk.cyan(" 查看命令說明"));
    console.log(chalk.cyan("  • 輸入 ") + chalk.green("/add <文件>") + chalk.cyan(" 添加文件到上下文"));
    console.log(chalk.cyan("  • 多行輸入：每行行尾加 ") + chalk.green("\\") + chalk.cyan(" 繼續，不加則提交"));
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
   * 添加文件到上下文
   */
  public addFile(filepath: string): void {
    this.activeFiles.add(filepath);
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


