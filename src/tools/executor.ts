/**
 * 工具執行器：負責執行工具調用並處理結果
 */

import chalk from "chalk";
import { ToolRegistry } from "./registry";
import { ToolCall, ToolResult, ToolExecutionContext } from "./types";
import readline from "readline";

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private context: ToolExecutionContext
  ) {}

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
    const validationError = this.validateParams(tool.definition.parameters, toolCall.params);
    if (validationError) {
      return {
        success: false,
        error: validationError,
      };
    }

    // 根據安全模式決定是否需要確認
    if (this.context.safetyMode === "review") {
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `工具執行異常: ${errorMsg}`,
      };
    }
  }

  /**
   * 批量執行工具調用
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.execute(toolCall);
      results.push(result);

      // 如果某個工具失敗且不是 dry-run 模式，可以選擇中斷
      if (!result.success && this.context.safetyMode !== "dry-run") {
        console.log(chalk.red(`工具 "${toolCall.tool}" 執行失敗，停止後續執行`));
        break;
      }
    }

    return results;
  }

  /**
   * 驗證工具參數
   */
  private validateParams(
    paramDefs: Array<{ name: string; required?: boolean; description?: string }>,
    params: Record<string, any>
  ): string | null {
    const missingParams: string[] = [];
    for (const paramDef of paramDefs) {
      if (paramDef.required && !(paramDef.name in params)) {
        const desc = paramDef.description ? ` (${paramDef.description})` : '';
        missingParams.push(`${paramDef.name}${desc}`);
      }
    }
    if (missingParams.length > 0) {
      return `缺少必需參數: ${missingParams.join(', ')}。請確認工具調用的 XML 格式包含所有必需的 <param> 標籤。`;
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
      const allListeners: Map<string, Function[]> = new Map();
      ['data', 'readable', 'end', 'close', 'error'].forEach(event => {
        const listeners = process.stdin.listeners(event);
        if (listeners.length > 0) {
          allListeners.set(event, listeners as Function[]);
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
      const { createColoredDiff, getDiffStats, formatDiffStats } = await import("../fs/diff");

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
   * 更新執行上下文
   */
  updateContext(updates: Partial<ToolExecutionContext>): void {
    Object.assign(this.context, updates);
  }
}

