/**
 * @ 檔案提及（比照 Claude Code 的 @file）
 *
 * - 輸入中 @path 標記要附帶的檔案，提交時自動讀取並注入上下文
 * - Tab 補全：@partial 觸發工作區檔案路徑補全（循環選擇）
 */

import fs from "fs";
import path from "path";

export interface MentionResult {
  /** 用戶寫的原始標記（不含 @） */
  raw: string;
  /** 解析後的絕對路徑 */
  absolutePath: string;
  /** 相對於工作區的路徑 */
  relativePath: string;
  /** 是否成功讀取 */
  ok: boolean;
  /** 檔案內容（ok 時） */
  content?: string;
  /** 錯誤訊息 */
  error?: string;
}

/** 從輸入文本提取 @提及（@ 必須在行首或空白之後，郵箱等不誤觸發） */
export function extractMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /(?:^|\s)@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

/** 讀取單個提及（目錄 → 列出結構；檔案 → 讀取內容） */
function resolveOne(raw: string, workspaceRoot: string): MentionResult {
  const cleaned = raw.replace(/["']/g, "");
  const absolutePath = path.resolve(workspaceRoot, cleaned);
  const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");

  // 工作區邊界檢查
  if (!absolutePath.startsWith(path.resolve(workspaceRoot))) {
    return { raw, absolutePath, relativePath, ok: false, error: "路徑在工作區外" };
  }

  try {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      // 目錄：列出兩層結構
      const entries: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 2 || entries.length > 50) return;
        for (const entry of fs.readdirSync(dir)) {
          if (entry === "node_modules" || entry === ".git" || entry.startsWith(".")) continue;
          const full = path.join(dir, entry);
          const rel = path.relative(workspaceRoot, full).replace(/\\/g, "/");
          const isDir = fs.statSync(full).isDirectory();
          entries.push(rel + (isDir ? "/" : ""));
          if (isDir) walk(full, depth + 1);
        }
      };
      walk(absolutePath, 0);
      return {
        raw,
        absolutePath,
        relativePath,
        ok: true,
        content: `[目錄結構: ${relativePath}]\n${entries.join("\n")}`,
      };
    }

    // 檔案：讀取內容（上限 50KB）
    let content = fs.readFileSync(absolutePath, "utf8");
    if (content.length > 50 * 1024) {
      content = content.slice(0, 50 * 1024) + "\n...（檔案過長，已截斷）";
    }
    return { raw, absolutePath, relativePath, ok: true, content };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      raw,
      absolutePath,
      relativePath,
      ok: false,
      error: code === "ENOENT" ? "檔案不存在" : `讀取失敗: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 解析所有提及 */
export function resolveMentions(mentions: string[], workspaceRoot: string): MentionResult[] {
  const seen = new Set<string>();
  const results: MentionResult[] = [];
  for (const m of mentions) {
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(resolveOne(m, workspaceRoot));
  }
  return results;
}

/** 格式化提及結果為注入上下文 */
export function buildMentionContext(results: MentionResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    if (r.ok) {
      parts.push(`[附帶檔案: ${r.relativePath}]\n\`\`\`\n${r.content}\n\`\`\``);
    } else {
      parts.push(`[附帶檔案: ${r.raw} — ⚠️ ${r.error}]`);
    }
  }
  return parts.join("\n\n");
}

/**
 * 檔案路徑補全：給定部分路徑，回傳工作區內的匹配項
 * 遍歷工作區（排除 node_modules/.git/dist/隱藏目錄），最多回傳 limit 個
 */
export function findPathCompletions(partial: string, workspaceRoot: string, limit = 20): string[] {
  const partialLower = partial.toLowerCase().replace(/\\/g, "/");
  const results: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (results.length >= limit || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;

      const rel = path.relative(workspaceRoot, path.join(dir, entry.name)).replace(/\\/g, "/");
      if (rel.toLowerCase().includes(partialLower)) {
        results.push(rel + (entry.isDirectory() ? "/" : ""));
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  };

  walk(workspaceRoot, 0);
  return results;
}
