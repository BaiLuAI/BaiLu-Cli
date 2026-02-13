/**
 * 執行命令工具
 */

import path from "path";
import { Tool, ToolResult } from "../types.js";
import { runCommandSafe } from "../../runtime/runner.js";
import { getDefaultPolicy } from "../../runtime/policy.js";

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
      // Validate command parameter
      if (typeof params.command !== 'string' || !params.command.trim()) {
        return {
          success: false,
          error: '命令參數無效：必須是非空字符串',
        };
      }
      const command = params.command.trim();

      // Validate args parameter
      const args: string[] = [];
      if (params.args !== undefined) {
        if (!Array.isArray(params.args)) {
          return {
            success: false,
            error: '參數列表無效：必須是字符串數組',
          };
        }
        for (const arg of params.args) {
          if (typeof arg !== 'string') {
            return {
              success: false,
              error: '參數列表包含非字符串值',
            };
          }
          args.push(arg);
        }
      }

      // Validate and sanitize working directory
      let cwd: string;
      if (params.cwd && typeof params.cwd === 'string') {
        const rawCwd = params.cwd;
        
        // 在规范化之前检查路径遍历（重要：必须在 resolve 之前检查）
        if (rawCwd.includes('..')) {
          return {
            success: false,
            error: '工作目錄包含可疑路徑字符 (..)',
          };
        }
        
        // 检查其他危险字符
        if (/[<>"|?*\0]/.test(rawCwd)) {
          return {
            success: false,
            error: '工作目錄包含非法字符',
          };
        }
        
        cwd = path.resolve(rawCwd);
        
        // 确保解析后的路径在当前工作目录或其子目录内
        // 不允許絕對路徑繞過（防止 AI 在任意目錄執行命令）
        const currentDir = process.cwd();
        if (!cwd.startsWith(currentDir)) {
          return {
            success: false,
            error: `工作目錄必須在當前工作區內: ${currentDir}`,
          };
        }
      } else {
        cwd = process.cwd();
      }

      // Validate timeout parameter
      let timeout = 300 * 1000; // Default 300 seconds
      if (params.timeout !== undefined) {
        if (typeof params.timeout !== 'number' || params.timeout <= 0) {
          return {
            success: false,
            error: '超時參數無效：必須是正數',
          };
        }
        timeout = params.timeout * 1000;
      }

      const policy = getDefaultPolicy();
      policy.maxCommandDurationMs = timeout;

      const result = await runCommandSafe(cwd, command, args, policy);

      // Unified metadata structure for both success and failure
      const metadata = {
        command: result.command,
        args: result.args,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
      };

      if (result.exitCode === 0) {
        return {
          success: true,
          output: result.stdout || "(命令執行成功，無輸出)",
          metadata,
        };
      } else {
        return {
          success: false,
          error: result.stderr || `命令執行失敗，退出碼: ${result.exitCode}`,
          metadata,
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

