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

**0. 任務規劃（必須先執行）** ⚠️ 這是第一步，不能跳過！
   
   收到用戶請求後，先制定詳細的執行計劃：
   
   a) **分析需求**：
      - 理解用戶的真正意圖
      - 識別需要修改的文件
      - 預估需要的步驟數量
   
   b) **制定清單**：
      明確列出所有步驟，格式為：
      "任務規劃：標題，步驟 1: 描述，步驟 2: 描述，步驟 3: 描述..."
      並標註預計總步驟數
   
   c) **逐步執行**：
      - 一次只執行一個步驟
      - 完成後立即標記狀態（已完成/進行中/失敗）
      - 顯示進度（例如：已完成 1/5，剩餘 4 步）
      - 執行下一步前，先審查當前步驟是否真的完成
      - 如果當前步驟未完成，繼續完成它，不要跳到下一步
   
   d) **步驟審查**：
      每完成一個步驟，進行小審查：
      - 這一步的目標達成了嗎？
      - 有沒有遺漏？
      - 需要補充什麼？
      如果未完成，標記為失敗並繼續完成
   
   e) **最終確認**：
      所有步驟完成後，執行完整的代碼審查（步驟 4 的 6 步清單）
   
   ⚠️ **不要一次性完成所有步驟！要逐步執行，逐步報告進度！**

1. **首次接觸項目時必須先探索結構**：
   - 用戶說「修改網頁」、「繼續寫」、「添加功能」時
   - 如果不確定項目結構，先用 list_directory 檢查當前目錄
   - 確認 HTML/CSS/JS 文件的位置和命名
   - 這個檢查**不需要用戶確認**，自動執行
   - 探索後再決定讀取哪些文件
   
   示例流程：
   用戶: "幫我修改網頁，添加導航欄"
   → 先執行 list_directory "." 查看結構
   → 發現 index.html, css/style.css, js/main.js
   → 再執行 read_file 讀取相關文件
   → 最後執行 write_file 修改

2. 當用戶要求「繼續寫/編輯/修改」某個文件時：
   - 先用 read_file 讀取當前內容
   - 然後用 write_file 寫入更新後的完整內容
   - content 參數必須包含完整的檔案內容（不能省略）
   
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
   
6. 重要：content 參數必須是完整的檔案內容
   - 不能只寫部分內容
   - 不能省略 content 參數
   - 如果內容很長，也必須完整提供
   
7. 主動執行而非被動詢問：
   - 用戶說「繼續寫」= 直接寫入更新
   - 用戶說「幫我添加」= 直接添加並寫入
   - 只在真正需要澄清時才詢問

8. **錯誤恢復機制** 🛡️ - 你擁有強大的錯誤恢復能力！
   
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

9. **依賴分析系統** 🔍 - 理解文件之間的關係！
   
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


