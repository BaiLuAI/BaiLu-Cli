/**
 * 後台任務輸出輪詢與終止工具（比照 Claude Code 的 BashOutput / KillShell）
 */

import { Tool, ToolResult } from "../types.js";
import { globalBackgroundTasks } from "../background-tasks.js";

export const taskOutputTool: Tool = {
  definition: {
    name: "task_output",
    description: "查看後台任務的輸出與狀態。不帶 task_id 時列出所有後台任務。",
    safe: true,
    parameters: [
      {
        name: "task_id",
        type: "string",
        description: "後台任務 ID（run_command 以 run_in_background=true 啟動時返回）",
        required: false,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    const taskId = params.task_id as string | undefined;

    // 不帶 ID：列出所有任務
    if (!taskId) {
      const list = globalBackgroundTasks.list();
      if (list.length === 0) {
        return { success: true, output: "目前沒有後台任務" };
      }
      const lines = list.map((t) => `${t.id}  [${t.status}]  ${t.command}`);
      return {
        success: true,
        output: `後台任務（${list.length} 個）：\n${lines.join("\n")}`,
      };
    }

    const task = globalBackgroundTasks.getOutput(taskId);
    if (!task) {
      const list = globalBackgroundTasks.list();
      const hint = list.length > 0 ? `\n可用任務：${list.map((t) => t.id).join(", ")}` : "\n目前沒有後台任務";
      return { success: false, error: `任務不存在: ${taskId}${hint}` };
    }

    return {
      success: true,
      output: globalBackgroundTasks.formatOutput(task),
      metadata: { taskId, status: task.status, exitCode: task.exitCode },
    };
  },
};

export const taskKillTool: Tool = {
  definition: {
    name: "task_kill",
    description: "終止一個正在執行的後台任務。",
    parameters: [
      {
        name: "task_id",
        type: "string",
        description: "要終止的後台任務 ID",
        required: true,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    const taskId = params.task_id as string;

    if (typeof taskId !== "string" || !taskId.trim()) {
      return { success: false, error: "task_id 參數無效" };
    }

    const result = globalBackgroundTasks.kill(taskId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, output: `後台任務 ${taskId} 已終止` };
  },
};
