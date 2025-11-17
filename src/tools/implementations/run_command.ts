/**
 * 執行命令工具
 */

import { Tool, ToolResult } from "../types";
import { runCommandSafe } from "../../runtime/runner";
import { getDefaultPolicy } from "../../runtime/policy";

export const runCommandTool: Tool = {
  definition: {
    name: "run_command",
    description: "在當前工作目錄執行 shell 命令",
    parameters: [
      {
        name: "command",
        type: "string",
        description: "要執行的命令",
        required: true,
      },
      {
        name: "args",
        type: "array",
        description: "命令參數列表",
        required: false,
        default: [],
      },
      {
        name: "cwd",
        type: "string",
        description: "工作目錄，默認為當前目錄",
        required: false,
      },
      {
        name: "timeout",
        type: "number",
        description: "超時時間（秒），默認 300 秒",
        required: false,
        default: 300,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const command = params.command as string;
      const args = (params.args as string[]) || [];
      const cwd = (params.cwd as string) || process.cwd();
      const timeout = ((params.timeout as number) || 300) * 1000; // 轉換為毫秒

      const policy = getDefaultPolicy();
      policy.maxDuration = timeout;

      const result = await runCommandSafe(cwd, command, args, policy);

      if (result.exitCode === 0) {
        return {
          success: true,
          output: result.stdout || "(命令執行成功，無輸出)",
          metadata: {
            command: result.command,
            args: result.args,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          },
        };
      } else {
        return {
          success: false,
          error: result.stderr || `命令執行失敗，退出碼: ${result.exitCode}`,
          metadata: {
            command: result.command,
            args: result.args,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          },
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `執行命令失敗: ${errorMsg}`,
      };
    }
  },
};

