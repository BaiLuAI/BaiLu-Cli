/**
 * 代碼搜索工具 - 在文件中搜索文本/正則表達式
 * 類似 grep/ripgrep，但內建於工具系統，更安全且輸出格式化
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import readline from "readline";
import { Tool, ToolResult } from "../types.js";
import { validatePath } from "../../utils/path-validator.js";

const MAX_RESULTS = 200;
const MAX_LINE_LENGTH = 500;
const CONTEXT_LINES = 2;

const DEFAULT_EXCLUDES = [
  "node_modules", ".git", "dist", "build", ".bailu",
  "coverage", ".next", ".nuxt", "__pycache__", ".venv",
  "vendor", ".DS_Store", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
];

function shouldExclude(filePath: string, excludes: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return excludes.some((ex) => normalized.includes(`/${ex}/`) || normalized.endsWith(`/${ex}`));
}

async function* walkFiles(dir: string, excludes: string[]): AsyncGenerator<string> {
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
      yield* walkFiles(fullPath, excludes);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function isBinaryFile(filePath: string): boolean {
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".exe", ".dll", ".so", ".dylib", ".o",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".sqlite", ".db",
  ]);
  return binaryExts.has(path.extname(filePath).toLowerCase());
}

function matchesGlob(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  const normalized = filePath.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    // 簡單 glob 匹配：*.ts, *.js 等
    if (pattern.startsWith("*.")) {
      return normalized.endsWith(pattern.slice(1));
    }
    // **/*.ext 匹配
    if (pattern.startsWith("**/")) {
      const suffix = pattern.slice(3);
      if (suffix.startsWith("*.")) {
        return normalized.endsWith(suffix.slice(1));
      }
      return normalized.includes(suffix);
    }
    return normalized.includes(pattern);
  });
}

export const grepSearchTool: Tool = {
  definition: {
    name: "grep_search",
    description: "在文件中搜索文本或正則表達式。返回匹配行及上下文。適合查找代碼引用、函數定義、特定字符串等。",
    safe: true,
    parameters: [
      {
        name: "pattern",
        type: "string",
        description: "搜索模式（正則表達式或純文本）",
        required: true,
      },
      {
        name: "path",
        type: "string",
        description: "搜索的目錄或文件路徑（默認為當前目錄）",
        required: false,
        default: ".",
      },
      {
        name: "include",
        type: "string",
        description: "文件過濾 glob，如 *.ts,*.js（逗號分隔）",
        required: false,
      },
      {
        name: "fixed_strings",
        type: "boolean",
        description: "是否按純文本匹配（非正則），默認 false",
        required: false,
        default: false,
      },
      {
        name: "case_sensitive",
        type: "boolean",
        description: "是否區分大小寫，默認 false",
        required: false,
        default: false,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const pattern = params.pattern as string;
      const searchPath = (params.path as string) || ".";
      const includeRaw = (params.include as string) || "";
      const fixedStrings = params.fixed_strings === true;
      const caseSensitive = params.case_sensitive === true;

      if (!pattern) {
        return { success: false, error: "搜索模式不能為空" };
      }

      const workspaceRoot = process.cwd();
      const pathValidation = validatePath(searchPath, workspaceRoot);
      if (!pathValidation.valid) {
        return { success: false, error: `路徑驗證失敗: ${pathValidation.error}` };
      }
      const absolutePath = pathValidation.normalizedPath!;

      // 構建正則
      let regex: RegExp;
      try {
        const flags = caseSensitive ? "g" : "gi";
        const src = fixedStrings ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
        regex = new RegExp(src, flags);
      } catch (e) {
        return { success: false, error: `無效的正則表達式: ${pattern}` };
      }

      const includePatterns = includeRaw ? includeRaw.split(",").map((s) => s.trim()) : [];

      interface Match {
        file: string;
        line: number;
        content: string;
        contextBefore: string[];
        contextAfter: string[];
      }

      const matches: Match[] = [];
      let filesSearched = 0;
      let truncated = false;

      const stat = await fs.stat(absolutePath);
      const filesToSearch: string[] = [];

      if (stat.isFile()) {
        filesToSearch.push(absolutePath);
      } else {
        for await (const file of walkFiles(absolutePath, DEFAULT_EXCLUDES)) {
          if (isBinaryFile(file)) continue;
          if (!matchesGlob(file, includePatterns)) continue;
          filesToSearch.push(file);
        }
      }

      for (const file of filesToSearch) {
        if (matches.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }

        filesSearched++;
        const stream = fsSync.createReadStream(file, { encoding: "utf-8" });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        const lines: string[] = [];
        let lineNum = 0;

        for await (const line of rl) {
          lines.push(line);
          lineNum++;
          regex.lastIndex = 0;

          if (regex.test(line)) {
            const displayLine = line.length > MAX_LINE_LENGTH
              ? line.substring(0, MAX_LINE_LENGTH) + "..."
              : line;

            const contextBefore: string[] = [];
            const contextAfter: string[] = [];

            for (let i = Math.max(0, lines.length - 1 - CONTEXT_LINES); i < lines.length - 1; i++) {
              contextBefore.push(lines[i]);
            }

            matches.push({
              file: path.relative(workspaceRoot, file),
              line: lineNum,
              content: displayLine,
              contextBefore,
              contextAfter, // 會在後面填充
            });

            if (matches.length >= MAX_RESULTS) {
              truncated = true;
              break;
            }
          }
        }

        stream.destroy();
      }

      if (matches.length === 0) {
        return {
          success: true,
          output: `未找到匹配 "${pattern}" 的結果（搜索了 ${filesSearched} 個文件）`,
          metadata: { matchCount: 0, filesSearched },
        };
      }

      // 按文件分組輸出
      const grouped = new Map<string, Match[]>();
      for (const m of matches) {
        const arr = grouped.get(m.file) || [];
        arr.push(m);
        grouped.set(m.file, arr);
      }

      let output = "";
      for (const [file, fileMatches] of grouped) {
        output += `\n📄 ${file} (${fileMatches.length} 個匹配)\n`;
        for (const m of fileMatches) {
          output += `  ${m.line}: ${m.content}\n`;
        }
      }

      if (truncated) {
        output += `\n⚠️ 結果已截斷（顯示前 ${MAX_RESULTS} 個匹配）。請用更精確的模式或 include 過濾縮小範圍。\n`;
      }

      output = `找到 ${matches.length} 個匹配（${grouped.size} 個文件，搜索了 ${filesSearched} 個文件）\n${output}`;

      return {
        success: true,
        output,
        metadata: {
          matchCount: matches.length,
          fileCount: grouped.size,
          filesSearched,
          truncated,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `搜索失敗: ${errorMsg}` };
    }
  },
};
