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
          console.log(chalk.green(`✓ 執行成功`));
        } else {
          console.log(chalk.red(`✗ 執行失敗: ${result.error}`));
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
    paramDefs: Array<{ name: string; required?: boolean }>,
    params: Record<string, any>
  ): string | null {
    for (const paramDef of paramDefs) {
      if (paramDef.required && !(paramDef.name in params)) {
        return `缺少必需參數: ${paramDef.name}`;
      }
    }
    return null;
  }

  /**
   * 請求用戶批准（review 模式）
   */
  private async requestApproval(toolCall: ToolCall): Promise<boolean> {
    console.log(chalk.yellow("\n[需要確認]"));
    console.log(chalk.cyan(`工具: ${toolCall.tool}`));
    console.log(chalk.cyan(`參數: ${JSON.stringify(toolCall.params, null, 2)}`));

    // 對於 write_file，顯示 diff 預覽
    if (toolCall.tool === "write_file" && toolCall.params.path) {
      await this.showDiffPreview(toolCall.params.path as string, toolCall.params.content as string);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(chalk.yellow("是否執行此操作? [y/n/d(顯示詳細diff)/q(退出)]: "), (answer) => {
        rl.close();

        const normalized = answer.trim().toLowerCase();
        if (normalized === "q" || normalized === "quit") {
          console.log(chalk.red("用戶中止操作"));
          process.exit(0);
        }

        if (normalized === "d" || normalized === "diff") {
          // 顯示完整 diff 後重新詢問
          this.showDiffPreview(toolCall.params.path as string, toolCall.params.content as string, true).then(
            () => {
              this.requestApproval(toolCall).then(resolve);
            }
          );
          return;
        }

        resolve(normalized === "y" || normalized === "yes");
      });
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

