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
 * 命令选项基础接口
 */
export interface BaseCommandOptions {
  [key: string]: unknown;
}
