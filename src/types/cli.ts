/**
 * CLI 相关类型定义
 */

/**
 * Run 命令选项
 */
export interface RunCommandOptions {
  resume?: string;
  list?: boolean;
}

/**
 * 安全模式类型
 */
export type SafetyMode = "dry-run" | "review" | "auto-apply";

/**
 * Fix 命令选项
 */
export interface FixCommandOptions {
  mode?: SafetyMode;
  maxIterations?: number;
  verbose?: boolean;
}

/**
 * 命令选项基础接口
 */
export interface BaseCommandOptions {
  [key: string]: unknown;
}
