/**
 * 列出目錄內容工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types.js";
import { validatePath } from "../../utils/path-validator.js";

export const listDirectoryTool: Tool = {
  definition: {
    name: "list_directory",
    description: "列出指定目錄下的文件和子目錄",
    safe: true, // 只读操作，自动批准
    parameters: [
      {
        name: "path",
        type: "string",
        description: "目錄的相對或絕對路徑，默認為當前目錄",
        required: false,
        default: ".",
      },
      {
        name: "recursive",
        type: "boolean",
        description: "是否遞迴列出子目錄，默認 false",
        required: false,
        default: false,
      },
      {
        name: "include_hidden",
        type: "boolean",
        description: "是否包含隱藏文件（以 . 開頭），默認 false",
        required: false,
        default: false,
      },
    ],
  },

  handler: async (params, context): Promise<ToolResult> => {
    try {
      const dirPath = (params.path as string) || ".";
      const recursive = params.recursive === true;
      const includeHidden = params.include_hidden === true;

      // 以執行上下文的工作區為基準（而非 process.cwd）
      const workspaceRoot = context?.workspaceRoot || process.cwd();

      // 路徑邊界驗證（防路徑遍歷與工作區外目錄）
      const validation = validatePath(dirPath, workspaceRoot);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const absoluteDir = validation.normalizedPath!;

      const entries = await listDir(absoluteDir, recursive, includeHidden);

      const output = entries.join("\n");

      return {
        success: true,
        output,
        metadata: {
          path: dirPath,
          count: entries.length,
          recursive,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `列出目錄失敗: ${errorMsg}`,
      };
    }
  },
};

/**
 * 遞迴列出目錄內容
 */
async function listDir(
  dirPath: string,
  recursive: boolean,
  includeHidden: boolean,
  prefix = ""
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    // 跳過隱藏文件
    if (!includeHidden && entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    const displayPath = prefix + entry.name;

    if (entry.isDirectory()) {
      results.push(displayPath + "/");
      if (recursive) {
        const subEntries = await listDir(fullPath, recursive, includeHidden, displayPath + "/");
        results.push(...subEntries);
      }
    } else {
      results.push(displayPath);
    }
  }

  return results;
}

