/**
 * Diff 生成工具（使用 diff 庫 + 彩色輸出）
 */

import * as Diff from "diff";
import chalk from "chalk";

export interface DiffResult {
  filePath: string;
  unifiedDiff: string;
}

/**
 * 生成 unified diff
 */
export function createUnifiedDiff(filePath: string, before: string, after: string): DiffResult {
  if (before === after) {
    return { filePath, unifiedDiff: "" };
  }

  // 使用 diff 庫生成真正的 unified diff
  const patch = Diff.createPatch(filePath, before, after, "", "");
  return { filePath, unifiedDiff: patch };
}

/**
 * 生成彩色的 diff 輸出（用於終端顯示）
 */
export function createColoredDiff(filePath: string, before: string, after: string): string {
  if (before === after) {
    return chalk.gray("(無改動)");
  }

  const patch = Diff.createPatch(filePath, before, after, "", "");
  const lines = patch.split("\n");
  const colored: string[] = [];

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      colored.push(chalk.bold(line));
    } else if (line.startsWith("@@")) {
      colored.push(chalk.cyan(line));
    } else if (line.startsWith("+")) {
      colored.push(chalk.green(line));
    } else if (line.startsWith("-")) {
      colored.push(chalk.red(line));
    } else if (line.startsWith("\\")) {
      colored.push(chalk.gray(line));
    } else {
      // 上下文行
      colored.push(line);
    }
  }

  return colored.join("\n");
}

/**
 * 生成簡潔的 diff 統計（用於摘要）
 */
export function getDiffStats(before: string, after: string): { added: number; removed: number } {
  const changes = Diff.diffLines(before, after);
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    if (change.added) {
      added += change.count || 0;
    } else if (change.removed) {
      removed += change.count || 0;
    }
  }

  return { added, removed };
}

/**
 * 格式化 diff 統計為可讀字符串
 */
export function formatDiffStats(stats: { added: number; removed: number }): string {
  const parts: string[] = [];
  if (stats.added > 0) {
    parts.push(chalk.green(`+${stats.added}`));
  }
  if (stats.removed > 0) {
    parts.push(chalk.red(`-${stats.removed}`));
  }
  return parts.join(" ");
}
