/**
 * Hooks 鉤子系統（比照 Claude Code 的 hooks）
 *
 * 在 .bailu.yml 配置，於工具調用生命週期的關鍵點執行自定義 shell 命令：
 *
 *   hooks:
 *     PreToolUse:                      # 工具執行前（可攔截）
 *       - matcher: "write_file|edit_file"   # 可選，工具名正則
 *         command: "node .bailu/hooks/check.js"
 *         timeout: 10                   # 秒，默認 30
 *     PostToolUse:                     # 工具執行後
 *       - command: "eslint $BAILU_FILE"
 *     Stop:                            # Agent 回合結束
 *       - command: "notify-done.sh"
 *     Notification:                    # 需要用戶注意時（如等待批准）
 *       - command: "notify.sh"
 *
 * 環境變數：BAILU_HOOK_EVENT、BAILU_TOOL_NAME、BAILU_TOOL_PARAMS（JSON）、
 *          BAILU_TOOL_OUTPUT、BAILU_WORKSPACE
 * stdin 傳入完整 JSON payload。
 *
 * 退出碼語義（PreToolUse）：
 *   0 = 允許；2 = 阻止（stderr 作為原因）；其他 = 警告但繼續
 */

import { spawn } from "child_process";
import { ToolCall, ToolResult } from "../tools/types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Hooks");

export type HookEvent = "PreToolUse" | "PostToolUse" | "Stop" | "Notification";

export interface HookConfig {
  /** 工具名正則（僅 PreToolUse/PostToolUse），匹配才執行 */
  matcher?: string;
  /** 要執行的 shell 命令 */
  command: string;
  /** 超時（秒），默認 30 */
  timeout?: number;
}

export type HookConfigMap = Partial<Record<HookEvent, HookConfig[]>>;

export interface HookRunResult {
  /** PreToolUse：是否阻止工具執行 */
  blocked: boolean;
  /** 阻止原因或鉤子輸出 */
  message?: string;
}

export class HookRunner {
  constructor(
    private configs: HookConfigMap | undefined,
    private workspaceRoot: string
  ) {}

  /** 是否配置了某事件的鉤子 */
  has(event: HookEvent): boolean {
    return (this.configs?.[event]?.length ?? 0) > 0;
  }

  /** 執行單個鉤子命令 */
  private runCommand(hook: HookConfig, event: HookEvent, payload: Record<string, unknown>): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve) => {
      const timeoutSec = (hook.timeout ?? 30) * 1000;
      let stdout = "";
      let stderr = "";
      let finished = false;

      const child = spawn(hook.command, {
        shell: true,
        cwd: this.workspaceRoot,
        env: {
          ...process.env,
          BAILU_HOOK_EVENT: event,
          BAILU_WORKSPACE: this.workspaceRoot,
        },
      });

      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
          resolve({ exitCode: -1, stdout, stderr: stderr + "\n[鉤子超時]" });
        }
      }, timeoutSec);

      child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

      child.on("close", (code) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({ exitCode: code ?? -1, stdout, stderr });
        }
        // 銷毀串流，釋放事件循環句柄
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.removeAllListeners();
      });

      child.on("error", (err) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          resolve({ exitCode: -1, stdout, stderr: stderr + `\n[鉤子啟動失敗] ${err.message}` });
        }
      });

      // payload 經 stdin 傳入
      try {
        child.stdin?.write(JSON.stringify(payload));
        child.stdin?.end();
      } catch {
        // ignore
      }
    });
  }

  /** 執行某事件的所有匹配鉤子 */
  private async runEvent(
    event: HookEvent,
    payload: Record<string, unknown>,
    toolName?: string
  ): Promise<HookRunResult> {
    const hooks = this.configs?.[event];
    if (!hooks || hooks.length === 0) return { blocked: false };

    const messages: string[] = [];
    let blocked = false;
    let blockReason = "";

    for (const hook of hooks) {
      // matcher 過濾（工具名正則）
      if (hook.matcher && toolName) {
        try {
          if (!new RegExp(hook.matcher).test(toolName)) continue;
        } catch {
          logger.warn(`無效的 matcher 正則: ${hook.matcher}`);
          continue;
        }
      }

      const result = await this.runCommand(hook, event, payload);

      if (event === "PreToolUse" && result.exitCode === 2) {
        // 退出碼 2 = 阻止
        blocked = true;
        blockReason = result.stderr.trim() || "被 PreToolUse 鉤子阻止";
        break;
      } else if (result.exitCode !== 0) {
        messages.push(`[鉤子警告] ${hook.command}: ${result.stderr.trim() || `退出碼 ${result.exitCode}`}`);
      } else if (result.stdout.trim() || result.stderr.trim()) {
        const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
        messages.push(output);
      }
    }

    return { blocked, message: blocked ? blockReason : messages.join("\n") || undefined };
  }

  /** PreToolUse：工具執行前（可攔截） */
  async runPreToolUse(toolCall: ToolCall): Promise<HookRunResult> {
    return this.runEvent(
      "PreToolUse",
      { tool: toolCall.tool, params: toolCall.params, timestamp: new Date().toISOString() },
      toolCall.tool
    );
  }

  /** PostToolUse：工具執行後 */
  async runPostToolUse(toolCall: ToolCall, result: ToolResult): Promise<HookRunResult> {
    return this.runEvent(
      "PostToolUse",
      {
        tool: toolCall.tool,
        params: toolCall.params,
        success: result.success,
        output: (result.output || "").slice(0, 10000),
        error: result.error,
        timestamp: new Date().toISOString(),
      },
      toolCall.tool
    );
  }

  /** Stop：Agent 回合結束 */
  async runStop(finalResponse: string): Promise<HookRunResult> {
    return this.runEvent("Stop", {
      finalResponse: finalResponse.slice(0, 10000),
      timestamp: new Date().toISOString(),
    });
  }

  /** Notification：需要用戶注意 */
  async runNotification(message: string): Promise<HookRunResult> {
    return this.runEvent("Notification", {
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
