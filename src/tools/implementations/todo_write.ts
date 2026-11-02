/**
 * Todo 任務追蹤工具（比照 Claude Code 的 TodoWrite）
 * 用於多步驟任務的進度可視化
 */

import chalk from "chalk";
import { Tool, ToolResult } from "../types.js";
import { globalTodoStore, TodoItem } from "../todo-store.js";

export const todoWriteTool: Tool = {
  definition: {
    name: "todo_write",
    description:
      "更新任務清單以追蹤多步驟任務的進度。每次調用會全量替換清單。" +
      "規則：開始複雜任務時先建立清單；開始某項工作前把它設為 in_progress；完成後立即設為 completed；" +
      "同時只能有 1 個 in_progress。簡單單一步驟任務不需要使用。",
    safe: true,
    parameters: [
      {
        name: "todos",
        type: "array",
        description:
          '任務陣列，每項為 {"content": "任務描述", "status": "pending|in_progress|completed"}',
        required: true,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    const todos = params.todos as TodoItem[] | undefined;

    if (!Array.isArray(todos)) {
      return {
        success: false,
        error:
          'todos 參數必須是陣列，例如: [{"content": "分析代碼", "status": "in_progress"}, {"content": "寫測試", "status": "pending"}]',
      };
    }

    const error = globalTodoStore.set(todos);
    if (error) {
      return { success: false, error };
    }

    // 渲染清單給用戶看
    console.log("\n" + chalk.bold.cyan("📋 任務清單已更新"));
    console.log(globalTodoStore.render());
    console.log();

    const all = globalTodoStore.getAll();
    const completed = all.filter((t) => t.status === "completed").length;

    return {
      success: true,
      output: `任務清單已更新：${completed}/${all.length} 已完成`,
      metadata: { total: all.length, completed },
    };
  },
};
