/**
 * 權限規則引擎（比照 Claude Code 的 permissions allow/deny）
 *
 * 規則格式（配置於 .bailu.yml 的 permissions.allow / permissions.deny）：
 *   - "Bash(npm test:*)"   → run_command 命令以 "npm test" 開頭者
 *   - "Bash(git status)"   → run_command 命令完全等於 "git status"
 *   - "read_file"          → 該工具一律適用（唯讀工具自動允許用）
 *   - "write_file"         → 該工具一律適用
 *
 * 優先級：deny > allow > 預設流程（review 詢問 / auto-apply 執行）
 * deny 規則在所有模式下生效（包括 auto-apply）。
 */

import { ToolCall } from "../tools/types.js";

export interface PermissionRule {
  /** 工具名稱（Bash 為 run_command 的別名） */
  tool: string;
  /** 參數模式；空字串表示整個工具 */
  pattern: string;
  /** true = 前綴匹配（規則含 ":*"） */
  isPrefix: boolean;
}

/** Bash 規則對應的實際工具名 */
const BASH_ALIAS = "Bash";
const BASH_TOOL = "run_command";

export function parseRule(rule: string): PermissionRule | null {
  if (typeof rule !== "string") return null;
  const trimmed = rule.trim();
  if (!trimmed) return null;

  // Bash(...) 形式
  const parenMatch = trimmed.match(/^(\w+)\((.+)\)$/);
  if (parenMatch) {
    const tool = parenMatch[1];
    let pattern = parenMatch[2];
    let isPrefix = false;

    if (pattern.endsWith(":*")) {
      isPrefix = true;
      pattern = pattern.slice(0, -2).trim();
    }

    return {
      tool: tool === BASH_ALIAS ? BASH_TOOL : tool,
      pattern,
      isPrefix,
    };
  }

  // 純工具名形式
  return { tool: trimmed, pattern: "", isPrefix: false };
}

/** 檢查單條規則是否匹配工具調用 */
export function matchRule(rule: PermissionRule, toolCall: ToolCall): boolean {
  if (toolCall.tool !== rule.tool) return false;

  // 純工具名規則：整個工具匹配
  if (!rule.pattern) return true;

  if (rule.tool === BASH_TOOL) {
    const command = String(toolCall.params.command || "").trim();
    if (!command) return false;
    return rule.isPrefix
      ? command === rule.pattern || command.startsWith(`${rule.pattern} `)
      : command === rule.pattern;
  }

  // 其他工具：匹配 path 參數前綴（保留擴展空間）
  const target = String(toolCall.params.path || "");
  return rule.isPrefix ? target.startsWith(rule.pattern) : target === rule.pattern;
}

export type PermissionDecision = "allowed" | "denied" | "ask";

/**
 * 檢查權限：deny 優先於 allow；都未匹配回傳 ask（走預設流程）
 */
export function checkPermissions(
  allow: string[] | undefined,
  deny: string[] | undefined,
  toolCall: ToolCall
): PermissionDecision {
  const denyRules = (deny || []).map(parseRule).filter((r): r is PermissionRule => r !== null);
  for (const rule of denyRules) {
    if (matchRule(rule, toolCall)) return "denied";
  }

  const allowRules = (allow || []).map(parseRule).filter((r): r is PermissionRule => r !== null);
  for (const rule of allowRules) {
    if (matchRule(rule, toolCall)) return "allowed";
  }

  return "ask";
}
