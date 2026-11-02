/**
 * Todo 任務追蹤（比照 Claude Code 的 TodoWrite）
 *
 * AI 執行多步驟任務時維護即時清單，用戶可隨時看到進度。
 * 狀態流轉：pending → in_progress → completed
 */

import chalk from "chalk";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

class TodoStore {
  private todos: TodoItem[] = [];

  /**
   * 更新整個清單（全量替換，與 Claude Code 語義一致）
   * @returns 錯誤訊息（null 表示成功）
   */
  set(todos: TodoItem[]): string | null {
    if (!Array.isArray(todos)) {
      return "todos 必須是陣列";
    }

    for (const todo of todos) {
      if (!todo || typeof todo.content !== "string" || !todo.content.trim()) {
        return "每個 todo 必須包含非空 content";
      }
      if (!["pending", "in_progress", "completed"].includes(todo.status)) {
        return `無效的狀態: ${todo.status}（可用: pending / in_progress / completed）`;
      }
    }

    const inProgress = todos.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      return `同時只能有 1 個 in_progress 任務（目前 ${inProgress.length} 個）。請把其他任務設為 pending 或 completed。`;
    }

    this.todos = todos.map((t) => ({ content: t.content.trim(), status: t.status }));
    return null;
  }

  getAll(): TodoItem[] {
    return [...this.todos];
  }

  clear(): void {
    this.todos = [];
  }

  /** 渲染為終端清單（給用戶看） */
  render(): string {
    if (this.todos.length === 0) {
      return chalk.gray("(空清單)");
    }

    const lines: string[] = [];
    const groups: Array<{ status: TodoStatus; icon: string; label: (n: number) => string; color: (s: string) => string }> = [
      { status: "in_progress", icon: "🔄", label: (n) => `進行中 (${n})`, color: chalk.cyan },
      { status: "pending", icon: "⏳", label: (n) => `待處理 (${n})`, color: chalk.yellow },
      { status: "completed", icon: "✅", label: (n) => `已完成 (${n})`, color: chalk.green },
    ];

    for (const group of groups) {
      const items = this.todos.filter((t) => t.status === group.status);
      if (items.length === 0) continue;

      lines.push(group.color(`${group.icon} ${group.label(items.length)}`));
      for (const item of items) {
        const mark = group.status === "completed" ? chalk.green("✔") : group.status === "in_progress" ? chalk.cyan("▸") : chalk.gray("○");
        const text = group.status === "completed" ? chalk.gray(item.content) : item.content;
        lines.push(`   ${mark} ${text}`);
      }
    }

    return lines.join("\n");
  }

  /** 純文字摘要（給 LLM 看） */
  summarize(): string {
    if (this.todos.length === 0) return "(無任務)";
    return this.todos
      .map((t) => `[${t.status === "completed" ? "x" : t.status === "in_progress" ? ">" : " "}] ${t.content}`)
      .join("\n");
  }
}

export const globalTodoStore = new TodoStore();
