/**
 * 工具執行器：負責執行工具調用並處理結果
 */

import chalk from "chalk";
import path from "path";
import fs from "fs/promises";
import { ToolRegistry } from "./registry.js";
import { ToolCall, ToolResult, ToolExecutionContext, ToolDefinition, ToolParameter } from "./types.js";
import { GracefulExitError } from "../utils/graceful-exit.js";

/**
 * 簡單的備份管理器
 */
class SimpleBackupManager {
  private backups: Map<string, string[]> = new Map();

  async createBackup(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const backups = this.backups.get(filePath) || [];
      backups.push(content);
      this.backups.set(filePath, backups);
      return true;
    } catch {
      return false;
    }
  }

  getBackupCount(filePath: string): number {
    return (this.backups.get(filePath) || []).length;
  }

  async rollback(filePath: string): Promise<boolean> {
    const backups = this.backups.get(filePath);
    if (!backups || backups.length === 0) return false;
    
    const lastBackup = backups.pop();
    if (lastBackup !== undefined) {
      await fs.writeFile(filePath, lastBackup, 'utf-8');
      return true;
    }
    return false;
  }
}

export class ToolExecutor {
  private backupManager: SimpleBackupManager;
  private workspaceRoot: string;

  constructor(
    private registry: ToolRegistry,
    private context: ToolExecutionContext
  ) {
    this.backupManager = new SimpleBackupManager();
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
      const absolutePath = path.resolve(this.workspaceRoot, filePath);
      
      if (!absolutePath.startsWith(this.workspaceRoot)) {
        return { 
          valid: false, 
          error: `路径遍历攻击检测：路径 "${filePath}" 在工作区外` 
        };
      }

      const suspicious = ['../', '..\\', '%2e%2e'];
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
        console.log();
      }
    }

    // dry-run 模式
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
          const validation = this.validateFilePath(filePath);
          if (!validation.valid) {
            return {
              success: false,
              error: `🔒 安全检查失败: ${validation.error}`,
            };
          }
          await this.backupManager.createBackup(validation.sanitized!);
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n✗ 工具執行失敗: ${errorMsg}`));

      // 如果是写入操作失败，询问是否回滚
      if (toolCall.tool === 'write_file' || toolCall.tool === 'apply_diff') {
        const filePath = toolCall.params.path || toolCall.params.file;
        if (filePath && typeof filePath === 'string') {
          const validation = this.validateFilePath(filePath);
          if (validation.valid && this.backupManager.getBackupCount(validation.sanitized!) > 0) {
            console.log(chalk.yellow(`\n⚠️  检测到文件有备份，可以回滚`));
            
            if (this.context.safetyMode === "review") {
              const shouldRollback = await this.askForRollback(validation.sanitized!);
              if (shouldRollback) {
                const rolled = await this.backupManager.rollback(validation.sanitized!);
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

      return {
        success: false,
        error: `工具執行異常: ${errorMsg}`,
      };
    }
  }

  /**
   * 批量執行工具調用
   */
  async executeAll(toolCalls: ToolCall[], continueOnError = false): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.execute(toolCall);
      results.push(result);

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

  private getSuccessMessage(toolCall: ToolCall): string {
    const { tool, params } = toolCall;
    switch (tool) {
      case "read_file": return `已讀取檔案: ${params.path}`;
      case "write_file": return `已寫入檔案: ${params.path}`;
      case "list_directory": return `已列出目錄內容`;
      case "run_command": return `命令執行成功`;
      case "apply_diff": return `已應用差異`;
      default: return `執行成功`;
    }
  }

  private getErrorMessage(toolCall: ToolCall): string {
    const { tool, params } = toolCall;
    switch (tool) {
      case "read_file": return `讀取檔案失敗 (${params.path})`;
      case "write_file": return `寫入檔案失敗 (${params.path})`;
      case "list_directory": return `列出目錄失敗`;
      case "run_command": return `命令執行失敗`;
      case "apply_diff": return `應用差異失敗`;
      default: return `執行失敗`;
    }
  }

  /**
   * 請求用戶批准（review 模式）
   */
  private async requestApproval(toolCall: ToolCall): Promise<boolean> {
    console.log(chalk.yellow("\n[需要確認]"));
    console.log(this.humanizeToolCall(toolCall));

    if (toolCall.tool === "write_file" && toolCall.params.path) {
      await this.showDiffPreview(toolCall.params.path as string, toolCall.params.content as string);
    }

    return new Promise((resolve) => {
      process.stdout.write(chalk.yellow("是否執行此操作? [y/n/d(顯示詳細diff)/q(退出)]: "));
      
      const allListeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();
      ['data', 'readable', 'end', 'close', 'error'].forEach(event => {
        const listeners = process.stdin.listeners(event);
        if (listeners.length > 0) {
          allListeners.set(event, listeners as ((...args: unknown[]) => void)[]);
          process.stdin.removeAllListeners(event);
        }
      });
      
      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      process.stdin.resume();
      
      let buffer = '';
      
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        
        if (buffer.includes('\n')) {
          process.stdin.removeListener('data', onData);
          
          allListeners.forEach((listeners, event) => {
            listeners.forEach(listener => {
              process.stdin.on(event as any, listener as any);
            });
          });
          
          if (process.stdin.isTTY && wasRaw) {
            process.stdin.setRawMode(true);
          }
          
          const answer = buffer.trim().toLowerCase();
          
          if (answer === "q" || answer === "quit") {
            console.log(chalk.red("用戶中止操作"));
            throw new GracefulExitError();
          }

          if (answer === "d" || answer === "diff") {
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
      const fsModule = await import("fs/promises");
      const { createColoredDiff, getDiffStats, formatDiffStats } = await import("../fs/diff.js");

      let oldContent = "";
      try {
        oldContent = await fsModule.readFile(filePath, "utf-8");
      } catch {
        console.log(chalk.gray(`(新文件)`));
      }

      if (detailed || oldContent.split("\n").length < 50) {
        const coloredDiff = createColoredDiff(filePath, oldContent, newContent);
        console.log(chalk.bold("\n[Diff 預覽]"));
        console.log(coloredDiff);
      } else {
        const stats = getDiffStats(oldContent, newContent);
        console.log(chalk.bold(`\n[Diff 統計] ${formatDiffStats(stats)}`));
      }
    } catch (error) {
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

      const allListeners = new Map<string, ((...args: unknown[]) => void)[]>();
      ["data", "end", "error"].forEach((event) => {
        const listeners = process.stdin.listeners(event);
        if (listeners.length > 0) {
          allListeners.set(event, listeners as ((...args: unknown[]) => void)[]);
          process.stdin.removeAllListeners(event);
        }
      });

      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }

      process.stdin.resume();

      let buffer = "";

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();

        if (buffer.includes("\n")) {
          process.stdin.removeListener("data", onData);

          allListeners.forEach((listeners, event) => {
            listeners.forEach((listener) => {
              process.stdin.on(event as any, listener as any);
            });
          });

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
   * 更新執行上下文
   */
  updateContext(updates: Partial<ToolExecutionContext>): void {
    Object.assign(this.context, updates);
  }
}
