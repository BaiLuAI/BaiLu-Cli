/**
 * 工具執行器：負責執行工具調用並處理結果
 */

import chalk from "chalk";
import path from "path";
import { ToolRegistry } from "./registry.js";
import { ToolCall, ToolResult, ToolExecutionContext, ToolDefinition, ToolParameter } from "./types.js";
import { ErrorRecoveryManager, RetryAttempt } from "./recovery.js";
import readline from "readline";

export class ToolExecutor {
  private recovery: ErrorRecoveryManager;
  private workspaceRoot: string;

  constructor(
    private registry: ToolRegistry,
    private context: ToolExecutionContext
  ) {
    this.recovery = new ErrorRecoveryManager();
    // Get workspace root for path validation
    this.workspaceRoot = this.context.workspaceRoot || process.cwd();
  }

  /**
   * Validate and sanitize file path to prevent path traversal attacks
   */
  private validateFilePath(filePath: string): { valid: boolean; sanitized?: string; error?: string } {
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, error: '文件路径无效' };
    }

    try {
      // Resolve to absolute path
      const absolutePath = path.resolve(this.workspaceRoot, filePath);
      
      // Ensure the resolved path is within workspace
      if (!absolutePath.startsWith(this.workspaceRoot)) {
        return { 
          valid: false, 
          error: `路径遍历攻击检测：路径 "${filePath}" 在工作区外` 
        };
      }

      // Additional check: reject paths with suspicious patterns
      const suspicious = ['../', '..\\\\', '%2e%2e'];
      if (suspicious.some(pattern => filePath.includes(pattern))) {
        return { 
          valid: false, 
          error: `路径包含可疑字符："${filePath}"` 
        };
      }

      return { valid: true, sanitized: absolutePath };
    } catch (error) {
      return { 
        valid: false, 
        error: `路径验证失败: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * 執行單個工具調用
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.registry.get(toolCall.tool);

    if (!tool) {
      return {
        success: false,
        error: `工具 "${toolCall.tool}" 不存在`,
      };
    }

    // 驗證參數
    const validationError = this.validateParams(toolCall, tool.definition);
    if (validationError) {
      return {
        success: false,
        error: validationError,
      };
    }

    // 根據安全模式決定是否需要確認
    if (this.context.safetyMode === "review") {
      // 安全工具（只读操作）自动批准，无需用户确认
      if (tool.definition.safe) {
        console.log(chalk.gray(`[自動執行] ${this.humanizeToolCall(toolCall)}`));
      } else {
        const approved = await this.requestApproval(toolCall);
        if (!approved) {
          return {
            success: false,
            error: "用戶取消了操作",
          };
        }
        // 確認後添加換行，避免輸出混亂
        console.log();
      }
    }

    // dry-run 模式：只顯示計畫，不執行
    if (this.context.safetyMode === "dry-run") {
      console.log(chalk.yellow(`[DRY-RUN] 將執行工具: ${toolCall.tool}`));
      console.log(chalk.yellow(`[DRY-RUN] 參數: ${JSON.stringify(toolCall.params, null, 2)}`));
      return {
        success: true,
        output: "[DRY-RUN] 模擬執行成功",
      };
    }

    // 實際執行工具
    try {
      // 如果是写入操作，先验证路径并创建备份
      if (toolCall.tool === 'write_file' || toolCall.tool === 'apply_diff') {
        const filePath = toolCall.params.path || toolCall.params.file;
        if (filePath && typeof filePath === 'string') {
          // Validate file path to prevent path traversal
          const validation = this.validateFilePath(filePath);
          if (!validation.valid) {
            return {
              success: false,
              error: `🔒 安全检查失败: ${validation.error}`,
            };
          }
          
          // Use sanitized path for backup
          await this.recovery.createBackup(validation.sanitized!, toolCall.tool);
        }
      }

      if (this.context.verbose) {
        console.log(chalk.blue(`\n[工具執行] ${toolCall.tool}`));
        console.log(chalk.gray(`參數: ${JSON.stringify(toolCall.params, null, 2)}`));
      }

      const result = await tool.handler(toolCall.params);

      if (this.context.verbose) {
        if (result.success) {
          console.log(chalk.green(`✓ ${this.getSuccessMessage(toolCall)}`));
        } else {
          console.log(chalk.red(`✗ ${this.getErrorMessage(toolCall)}: ${result.error}`));
        }
      }

      return result;
    } catch (error) {
      // Improved error handling - preserve stack trace
      let err: Error;
      let errorMsg: string;
      
      if (error instanceof Error) {
        err = error;
        errorMsg = error.message;
      } else {
        errorMsg = String(error);
        err = new Error(errorMsg);
        // Preserve original error as property
        (err as any).originalError = error;
      }

      console.log(chalk.red(`\n✗ 工具執行失敗: ${errorMsg}`));

      // 尝试错误恢复
      const recoveryResult = await this.recovery.attemptRecovery(
        toolCall.tool,
        toolCall.params,
        err,
        1, // 第一次尝试
        []
      );

      // 如果是写入操作失败，询问是否回滚
      if (toolCall.tool === 'write_file' || toolCall.tool === 'apply_diff') {
        const filePath = toolCall.params.path || toolCall.params.file;
        if (filePath && typeof filePath === 'string') {
          // Validate path before rollback
          const validation = this.validateFilePath(filePath);
          if (!validation.valid) {
            console.log(chalk.yellow(`⚠️  无法回滚: ${validation.error}`));
          } else {
            const backupHistory = this.recovery.getBackupHistory(validation.sanitized!);
            if (backupHistory.length > 0) {
              console.log(chalk.yellow(`\n⚠️  检测到文件有备份，可以回滚`));
              console.log(chalk.gray(`   文件: ${filePath}`));
              console.log(chalk.gray(`   备份数: ${backupHistory.length}`));

              // 在 review 模式下询问用户是否回滚
              if (this.context.safetyMode === "review") {
                const shouldRollback = await this.askForRollback(validation.sanitized!);
                if (shouldRollback) {
                  const rolled = await this.recovery.rollbackFile(validation.sanitized!);
                  if (rolled) {
                    return {
                      success: false,
                      error: `工具執行失敗，已回滾: ${errorMsg}`,
                    };
                  }
                }
              }
            }
          }
        }
      }

      // 返回错误和恢复建议
      let errorMessage = `工具執行異常: ${errorMsg}`;
      if (recoveryResult.suggestedAction) {
        errorMessage += `\n\n建議操作:\n${recoveryResult.suggestedAction}`;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 批量執行工具調用
   * @param toolCalls - 要执行的工具调用列表
   * @param continueOnError - 出错时是否继续执行（默认：false）
   */
  async executeAll(toolCalls: ToolCall[], continueOnError = false): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.execute(toolCall);
      results.push(result);

      // 如果某個工具失敗且不是 dry-run 模式，根据 continueOnError 决定是否中断
      if (!result.success && this.context.safetyMode !== "dry-run" && !continueOnError) {
        console.log(chalk.red(`工具 "${toolCall.tool}" 執行失敗，停止後續執行`));
        break;
      }
    }

    return results;
  }

  /**
   * 驗證工具參數
   */
  private validateParams(toolCall: ToolCall, definition: ToolDefinition): string | null {
    const requiredParams = definition.parameters.filter((p: ToolParameter) => p.required);

    for (const param of requiredParams) {
      if (!(param.name in toolCall.params)) {
        // 調試：記錄缺失的參數和當前已有的參數
        if (process.env.BAILU_DEBUG) {
          console.log(chalk.yellow(`[DEBUG] 工具: ${toolCall.tool}`));
          console.log(chalk.yellow(`[DEBUG] 缺失參數: ${param.name}`));
          console.log(chalk.yellow(`[DEBUG] 已有參數: ${Object.keys(toolCall.params).join(', ') || '(無)'}`));
        }
        return `缺少必需參數: ${param.name} (${param.description})。請確認工具調用的 XML 格式包含所有必需的 <param> 標籤。`;
      }
    }

    return null;
  }

  /**
   * 將工具調用轉換為人類可讀的描述
   */
  private humanizeToolCall(toolCall: ToolCall): string {
    const { tool, params } = toolCall;

    switch (tool) {
      case "read_file":
        return `📖 讀取檔案: ${chalk.bold(params.path)}`;
      
      case "write_file":
        return `✍️  寫入檔案: ${chalk.bold(params.path)}`;
      
      case "list_directory":
        return `📂 列出目錄內容: ${chalk.bold(params.path || "當前目錄")}`;
      
      case "run_command":
        return `⚙️  執行命令: ${chalk.bold(params.command)}`;
      
      case "apply_diff":
        return `🔧 應用差異到: ${chalk.bold(params.path)}`;
      
      default:
        return `🔨 執行工具: ${tool}`;
    }
  }

  /**
   * 獲取工具執行成功的訊息
   */
  private getSuccessMessage(toolCall: ToolCall): string {
    const { tool, params } = toolCall;

    switch (tool) {
      case "read_file":
        return `已讀取檔案: ${params.path}`;
      
      case "write_file":
        return `已寫入檔案: ${params.path}`;
      
      case "list_directory":
        return `已列出目錄內容`;
      
      case "run_command":
        return `命令執行成功`;
      
      case "apply_diff":
        return `已應用差異`;
      
      default:
        return `執行成功`;
    }
  }

  /**
   * 獲取工具執行失敗的訊息
   */
  private getErrorMessage(toolCall: ToolCall): string {
    const { tool, params } = toolCall;

    switch (tool) {
      case "read_file":
        return `讀取檔案失敗 (${params.path})`;
      
      case "write_file":
        return `寫入檔案失敗 (${params.path})`;
      
      case "list_directory":
        return `列出目錄失敗`;
      
      case "run_command":
        return `命令執行失敗`;
      
      case "apply_diff":
        return `應用差異失敗`;
      
      default:
        return `執行失敗`;
    }
  }

  /**
   * 請求用戶批准（review 模式）
   */
  private async requestApproval(toolCall: ToolCall): Promise<boolean> {
    console.log(chalk.yellow("\n[需要確認]"));
    console.log(this.humanizeToolCall(toolCall));

    // 對於 write_file，顯示 diff 預覽
    if (toolCall.tool === "write_file" && toolCall.params.path) {
      await this.showDiffPreview(toolCall.params.path as string, toolCall.params.content as string);
    }

    // 使用同步方式讀取一行輸入，避免與主 readline 衝突
    return new Promise((resolve) => {
      process.stdout.write(chalk.yellow("是否執行此操作? [y/n/d(顯示詳細diff)/q(退出)]: "));
      
      // 保存當前所有 stdin 監聽器並移除（避免重複處理）
      const allListeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();
      ['data', 'readable', 'end', 'close', 'error'].forEach(event => {
        const listeners = process.stdin.listeners(event);
        if (listeners.length > 0) {
          allListeners.set(event, listeners as ((...args: unknown[]) => void)[]);
          process.stdin.removeAllListeners(event);
        }
      });
      
      // 設置 stdin 為正常模式（非 raw）
      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      // 確保 stdin 可讀
      process.stdin.resume();
      
      let buffer = '';
      
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        
        // 遇到換行符表示輸入完成
        if (buffer.includes('\n')) {
          // 移除我們的監聽器
          process.stdin.removeListener('data', onData);
          
          // 恢復所有原始監聽器
          allListeners.forEach((listeners, event) => {
            listeners.forEach(listener => {
              process.stdin.on(event as any, listener as any);
            });
          });
          
          // 恢復 raw mode（如果之前是 raw）
          if (process.stdin.isTTY && wasRaw) {
            process.stdin.setRawMode(true);
          }
          
          const answer = buffer.trim().toLowerCase();
          
          if (answer === "q" || answer === "quit") {
            console.log(chalk.red("用戶中止操作"));
            process.exit(0);
          }

          if (answer === "d" || answer === "diff") {
            // 顯示完整 diff 後重新詢問
            this.showDiffPreview(toolCall.params.path as string, toolCall.params.content as string, true).then(
              () => {
                this.requestApproval(toolCall).then(resolve);
              }
            );
            return;
          }

          resolve(answer === "y" || answer === "yes");
        }
      };
      
      process.stdin.on('data', onData);
    });
  }

  /**
   * 顯示 diff 預覽
   */
  private async showDiffPreview(filePath: string, newContent: string, detailed = false): Promise<void> {
    try {
      const fs = await import("fs/promises");
      const { createColoredDiff, getDiffStats, formatDiffStats } = await import("../fs/diff.js");

      let oldContent = "";
      try {
        oldContent = await fs.readFile(filePath, "utf-8");
      } catch {
        // 文件不存在，視為新文件
        console.log(chalk.gray(`(新文件)`));
      }

      if (detailed || oldContent.split("\n").length < 50) {
        // 顯示完整 diff
        const coloredDiff = createColoredDiff(filePath, oldContent, newContent);
        console.log(chalk.bold("\n[Diff 預覽]"));
        console.log(coloredDiff);
      } else {
        // 只顯示統計
        const stats = getDiffStats(oldContent, newContent);
        console.log(chalk.bold(`\n[Diff 統計] ${formatDiffStats(stats)}`));
      }
    } catch (error) {
      // 忽略預覽錯誤
      console.log(chalk.gray("(無法生成預覽)"));
    }
  }

  /**
   * 询问用户是否回滚文件
   */
  private async askForRollback(filePath: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      console.log(chalk.yellow(`\n是否回滚文件到修改前的状态？`));
      console.log(chalk.gray(`  文件: ${filePath}`));
      console.log(chalk.cyan(`  [y/yes] 回滚  [n/no] 不回滚`));
      process.stdout.write(chalk.cyan("你的选择: "));

      // 保存所有现有的监听器
      const allListeners = new Map<string, ((...args: unknown[]) => void)[]>();
      ["data", "end", "error"].forEach((event) => {
        const listeners = process.stdin.listeners(event);
        if (listeners.length > 0) {
          allListeners.set(event, listeners as ((...args: unknown[]) => void)[]);
          process.stdin.removeAllListeners(event);
        }
      });

      // 设置 stdin 为正常模式（非 raw）
      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }

      // 确保 stdin 可读
      process.stdin.resume();

      let buffer = "";

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();

        // 遇到换行符表示输入完成
        if (buffer.includes("\n")) {
          // 移除我们的监听器
          process.stdin.removeListener("data", onData);

          // 恢复所有原始监听器
          allListeners.forEach((listeners, event) => {
            listeners.forEach((listener) => {
              process.stdin.on(event as any, listener as any);
            });
          });

          // 恢复 raw mode（如果之前是 raw）
          if (process.stdin.isTTY && wasRaw) {
            process.stdin.setRawMode(true);
          }

          const answer = buffer.trim().toLowerCase();
          resolve(answer === "y" || answer === "yes");
        }
      };

      process.stdin.on("data", onData);
    });
  }

  /**
   * 获取错误恢复管理器
   */
  getRecoveryManager(): ErrorRecoveryManager {
    return this.recovery;
  }

  /**
   * 更新執行上下文
   */
  updateContext(updates: Partial<ToolExecutionContext>): void {
    Object.assign(this.context, updates);
  }
}
