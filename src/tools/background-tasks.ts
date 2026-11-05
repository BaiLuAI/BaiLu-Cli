/**
 * 後台任務管理器（比照 Claude Code 的 run_in_background / BashOutput / KillShell）
 *
 * 長時間命令（dev server、watch 模式、安裝依賴）可丟到後台執行，
 * AI 用 task_output 輪詢輸出、task_kill 終止，不會卡住 Agent 循環。
 */

import { spawn, ChildProcess } from "child_process";
import { SafetyPolicy, getDefaultPolicy, isCommandAllowed, containsShellInjection } from "../runtime/policy.js";

const MAX_OUTPUT_LENGTH = 1024 * 1024; // 單任務輸出上限 1MB

export type BgTaskStatus = "running" | "completed" | "failed" | "killed";

export interface BgTask {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  status: BgTaskStatus;
  exitCode: number | null;
  startedAt: Date;
  finishedAt?: Date;
}

export class BackgroundTaskManager {
  private tasks: Map<string, BgTask> = new Map();
  private counter = 0;

  /**
   * 啟動後台任務
   * @returns 錯誤訊息（含安全檢查），成功回傳 null 並填入 taskId
   */
  start(
    cwd: string,
    command: string,
    args: string[],
    policy: SafetyPolicy = getDefaultPolicy()
  ): { taskId?: string; error?: string } {
    if (typeof command !== "string" || !command.trim()) {
      return { error: "命令不能為空" };
    }

    const full = args.length > 0 ? `${command} ${args.join(" ")}` : command;

    // 與 runCommandSafe 相同的安全檢查
    if (!isCommandAllowed(policy, full)) {
      return { error: `命令被安全策略阻止：${full}` };
    }
    if (containsShellInjection(command)) {
      return { error: `命令包含不安全的 shell 字符：${command}` };
    }
    for (const arg of args) {
      if (containsShellInjection(arg)) {
        return { error: `命令參數包含不安全的 shell 字符：${arg}` };
      }
    }

    this.counter += 1;
    const id = `bg_${this.counter}`;

    const useShell = process.platform === "win32";
    const child = spawn(command, args, {
      cwd,
      shell: useShell,
      env: { ...process.env, BAILU_BACKGROUND: "1" },
    });

    const task: BgTask = {
      id,
      command,
      args,
      cwd,
      child,
      stdout: "",
      stderr: "",
      status: "running",
      exitCode: null,
      startedAt: new Date(),
    };

    child.stdout?.on("data", (data: Buffer) => {
      task.stdout += data.toString();
      if (task.stdout.length > MAX_OUTPUT_LENGTH) {
        task.stdout = task.stdout.slice(-MAX_OUTPUT_LENGTH / 2);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      task.stderr += data.toString();
      if (task.stderr.length > MAX_OUTPUT_LENGTH) {
        task.stderr = task.stderr.slice(-MAX_OUTPUT_LENGTH / 2);
      }
    });

    child.on("close", (code) => {
      if (task.status === "running") {
        task.status = code === 0 ? "completed" : "failed";
        task.exitCode = code;
        task.finishedAt = new Date();
      }
    });

    child.on("error", (err) => {
      task.stderr += `\n[啟動失敗] ${err.message}`;
      if (task.status === "running") {
        task.status = "failed";
        task.exitCode = -1;
        task.finishedAt = new Date();
      }
    });

    this.tasks.set(id, task);
    return { taskId: id };
  }

  /** 取得任務輸出與狀態 */
  getOutput(id: string, tailChars = 8000): BgTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return task;
  }

  /** 終止任務 */
  kill(id: string): { success: boolean; error?: string } {
    const task = this.tasks.get(id);
    if (!task) {
      return { success: false, error: `任務不存在: ${id}（用 task_output 查看可用任務）` };
    }
    if (task.status !== "running") {
      return { success: false, error: `任務已結束（狀態: ${task.status}）` };
    }

    task.status = "killed";
    task.finishedAt = new Date();
    try {
      // Windows 上 kill 只殺 shell，需要 taskkill /T 殺整棵進程樹
      if (process.platform === "win32" && task.child.pid) {
        spawn("taskkill", ["/PID", String(task.child.pid), "/T", "/F"], { shell: false });
      } else {
        task.child.kill("SIGTERM");
      }
    } catch (error) {
      return { success: false, error: `終止失敗: ${error instanceof Error ? error.message : String(error)}` };
    }

    return { success: true };
  }

  /** 列出所有任務 ID 與狀態 */
  list(): Array<{ id: string; command: string; status: BgTaskStatus }> {
    return Array.from(this.tasks.values()).map((t) => ({
      id: t.id,
      command: `${t.command} ${t.args.join(" ")}`.trim(),
      status: t.status,
    }));
  }

  /** 終止所有執行中的任務並釋放句柄（進程退出與測試清理用） */
  shutdownAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        task.status = "killed";
        task.finishedAt = new Date();
        try {
          if (process.platform === "win32" && task.child.pid) {
            spawn("taskkill", ["/PID", String(task.child.pid), "/T", "/F"], { shell: false });
          } else {
            task.child.kill("SIGTERM");
          }
        } catch {
          // ignore
        }
      }
      // 銷毀 stdio 串流，釋放事件循環句柄
      task.child.stdout?.destroy();
      task.child.stderr?.destroy();
      task.child.removeAllListeners();
    }
    this.tasks.clear();
  }

  /** 格式化任務輸出（給 LLM 與用戶） */
  formatOutput(task: BgTask, tailChars = 8000): string {
    const elapsed = ((task.finishedAt ?? new Date()).getTime() - task.startedAt.getTime()) / 1000;
    const statusLabel =
      task.status === "running" ? "執行中" :
      task.status === "completed" ? "已完成 (退出碼 0)" :
      task.status === "failed" ? `失敗 (退出碼 ${task.exitCode})` :
      "已終止";

    let output = (task.stdout + (task.stderr ? `\n[stderr]\n${task.stderr}` : "")).trim();
    if (output.length > tailChars) {
      output = `...(前面省略 ${output.length - tailChars} 字符)\n${output.slice(-tailChars)}`;
    }

    return `[後台任務 ${task.id}] ${task.command} ${task.args.join(" ")}\n狀態: ${statusLabel}（已運行 ${elapsed.toFixed(1)} 秒）\n${"─".repeat(50)}\n${output || "(尚無輸出)"}`;
  }
}

/** 全局後台任務管理器實例 */
export const globalBackgroundTasks = new BackgroundTaskManager();
