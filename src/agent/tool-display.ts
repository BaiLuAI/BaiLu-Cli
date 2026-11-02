/**
 * 工具調用的人性化顯示（供 orchestrator 與 UI 使用）
 */

import chalk from "chalk";
import { ToolCall } from "../tools/types.js";

/** 工具調用人性化描述（執行前列表用） */
export function humanizeToolCall(toolCall: ToolCall): string {
  const { tool, params } = toolCall;

  switch (tool) {
    case "read_file":
      return `讀取檔案 ${chalk.cyan(params.path)}`;
    case "write_file":
      return `寫入檔案 ${chalk.cyan(params.path)}`;
    case "edit_file":
      return `精確編輯 ${chalk.cyan(params.path)}`;
    case "list_directory":
      return `列出目錄 ${chalk.cyan(params.path || ".")}`;
    case "run_command":
      return `執行命令 ${chalk.cyan(params.command)}`;
    case "apply_diff":
      return `應用差異到 ${chalk.cyan(params.path)}`;
    case "grep_search":
      return `搜索內容 ${chalk.cyan(params.pattern)}`;
    case "file_search":
      return `搜索檔案 ${chalk.cyan(params.pattern)}`;
    case "todo_write":
      return `更新任務清單`;
    case "dispatch_agent":
      return `調度子代理 ${chalk.cyan(params.agent_type)}`;
    default:
      return `執行 ${tool}`;
  }
}

/** 工具執行中的動作描述（[EXECUTING] 行用） */
export function getToolActionDescription(toolCall: ToolCall): string {
  const { tool, params } = toolCall;

  switch (tool) {
    case "read_file":
      return `正在查看 ${chalk.cyan(params.path)}`;
    case "write_file":
      return `正在編輯 ${chalk.cyan(params.path)}`;
    case "edit_file":
      return `正在精確編輯 ${chalk.cyan(params.path)}`;
    case "list_directory":
      return `正在瀏覽目錄 ${chalk.cyan(params.path || ".")}`;
    case "run_command":
      return `正在執行命令 ${chalk.cyan(params.command)}`;
    case "apply_diff":
      return `正在應用修改到 ${chalk.cyan(params.path)}`;
    case "grep_search":
      return `正在搜索 ${chalk.cyan(params.pattern)}`;
    case "file_search":
      return `正在搜索檔案 ${chalk.cyan(params.pattern)}`;
    case "todo_write":
      return `正在更新任務清單`;
    case "dispatch_agent":
      return `正在調度子代理 ${chalk.cyan(params.agent_type)}`;
    default:
      return `正在執行 ${tool}`;
  }
}
