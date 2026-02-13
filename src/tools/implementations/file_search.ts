/**
 * 文件搜索工具 - 按名稱/glob 模式搜索文件和目錄
 * 類似 find/fd，但內建於工具系統
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types.js";
import { validatePath } from "../../utils/path-validator.js";

const MAX_RESULTS = 200;

const DEFAULT_EXCLUDES = [
  "node_modules", ".git", "dist", "build", ".bailu",
  "coverage", ".next", ".nuxt", "__pycache__", ".venv",
  "vendor",
];

function shouldExclude(filePath: string, excludes: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return excludes.some((ex) => normalized.includes(`/${ex}/`) || normalized.endsWith(`/${ex}`));
}

function matchesPattern(name: string, pattern: string, caseSensitive: boolean): boolean {
  const target = caseSensitive ? name : name.toLowerCase();
  const pat = caseSensitive ? pattern : pattern.toLowerCase();

  // glob: *.ts
  if (pat.startsWith("*.")) {
    return target.endsWith(pat.slice(1));
  }

  // glob: test_*
  if (pat.endsWith("*")) {
    return target.startsWith(pat.slice(0, -1));
  }

  // glob: *utils*
  if (pat.startsWith("*") && pat.endsWith("*")) {
    return target.includes(pat.slice(1, -1));
  }

  // 包含匹配
  return target.includes(pat);
}

interface FileEntry {
  relativePath: string;
  type: "file" | "directory";
  size?: number;
}

async function* walkAll(
  dir: string,
  excludes: string[],
  maxDepth: number,
  currentDepth: number = 0
): AsyncGenerator<{ fullPath: string; relativePath: string; isDir: boolean; size?: number }> {
  if (currentDepth > maxDepth) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (shouldExclude(fullPath, excludes)) continue;

    if (entry.isDirectory()) {
      yield { fullPath, relativePath: "", isDir: true };
      yield* walkAll(fullPath, excludes, maxDepth, currentDepth + 1);
    } else if (entry.isFile()) {
      let size: number | undefined;
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
      } catch {
        // ignore
      }
      yield { fullPath, relativePath: "", isDir: false, size };
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const fileSearchTool: Tool = {
  definition: {
    name: "file_search",
    description: "按文件名或 glob 模式搜索文件和目錄。適合查找特定文件、了解項目結構。",
    safe: true,
    parameters: [
      {
        name: "pattern",
        type: "string",
        description: "搜索模式（文件名、部分名稱或 glob 如 *.ts）",
        required: true,
      },
      {
        name: "path",
        type: "string",
        description: "搜索的根目錄（默認為當前目錄）",
        required: false,
        default: ".",
      },
      {
        name: "type",
        type: "string",
        description: "過濾類型：file（僅文件）、directory（僅目錄）、any（全部，默認）",
        required: false,
        default: "any",
      },
      {
        name: "max_depth",
        type: "number",
        description: "最大搜索深度（默認 10）",
        required: false,
        default: 10,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || ".";
      const typeFilter = (params.type as string) || "any";
      const maxDepth = (params.max_depth as number) || 10;

      if (!pattern) {
        return { success: false, error: "搜索模式不能為空" };
      }

      const workspaceRoot = process.cwd();
      const pathValidation = validatePath(searchPath, workspaceRoot);
      if (!pathValidation.valid) {
        return { success: false, error: `路徑驗證失敗: ${pathValidation.error}` };
      }
      const absolutePath = pathValidation.normalizedPath!;

      const results: FileEntry[] = [];
      let truncated = false;

      for await (const entry of walkAll(absolutePath, DEFAULT_EXCLUDES, maxDepth)) {
        if (results.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }

        const name = path.basename(entry.fullPath);
        const isDir = entry.isDir;

        // 類型過濾
        if (typeFilter === "file" && isDir) continue;
        if (typeFilter === "directory" && !isDir) continue;

        // 名稱匹配
        if (!matchesPattern(name, pattern, false)) continue;

        results.push({
          relativePath: path.relative(workspaceRoot, entry.fullPath),
          type: isDir ? "directory" : "file",
          size: entry.size,
        });
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `未找到匹配 "${pattern}" 的文件`,
          metadata: { matchCount: 0 },
        };
      }

      // 排序：目錄在前，然後按路徑
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.relativePath.localeCompare(b.relativePath);
      });

      let output = `找到 ${results.length} 個匹配：\n\n`;
      for (const r of results) {
        const icon = r.type === "directory" ? "📁" : "📄";
        const sizeStr = r.size !== undefined ? ` (${formatSize(r.size)})` : "";
        output += `${icon} ${r.relativePath}${sizeStr}\n`;
      }

      if (truncated) {
        output += `\n⚠️ 結果已截斷（顯示前 ${MAX_RESULTS} 個）。請用更精確的模式縮小範圍。\n`;
      }

      return {
        success: true,
        output,
        metadata: {
          matchCount: results.length,
          truncated,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `文件搜索失敗: ${errorMsg}` };
    }
  },
};
