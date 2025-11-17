/**
 * 列出目錄內容工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types";

export const listDirectoryTool: Tool = {
  definition: {
    name: "list_directory",
    description: "列出指定目錄下的文件和子目錄",
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

  handler: async (params): Promise<ToolResult> => {
    try {
      const dirPath = (params.path as string) || ".";
      const recursive = params.recursive === true;
      const includeHidden = params.include_hidden === true;

      // 安全檢查
      if (dirPath.includes("..") && !path.isAbsolute(dirPath)) {
        return {
          success: false,
          error: "不允許使用相對路徑 '..'，請使用絕對路徑或工作區內的相對路徑",
        };
      }

      const entries = await listDir(dirPath, recursive, includeHidden);

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

