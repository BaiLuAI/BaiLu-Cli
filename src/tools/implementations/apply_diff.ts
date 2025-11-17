/**
 * 應用 diff 補丁工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types";

export const applyDiffTool: Tool = {
  definition: {
    name: "apply_diff",
    description: "將 unified diff 補丁應用到文件",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "目標文件的路徑",
        required: true,
      },
      {
        name: "diff",
        type: "string",
        description: "unified diff 格式的補丁內容",
        required: true,
      },
      {
        name: "create_backup",
        type: "boolean",
        description: "是否創建備份文件，默認 true",
        required: false,
        default: true,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const filePath = params.path as string;
      const diffContent = params.diff as string;
      const createBackup = params.create_backup !== false;

      // 安全檢查
      if (filePath.includes("..") && !path.isAbsolute(filePath)) {
        return {
          success: false,
          error: "不允許使用相對路徑 '..'，請使用絕對路徑或工作區內的相對路徑",
        };
      }

      // 讀取原文件
      let original: string;
      try {
        original = await fs.readFile(filePath, "utf-8");
      } catch {
        // 文件不存在，視為空文件
        original = "";
      }

      // 創建備份
      if (createBackup && original) {
        const backupPath = `${filePath}.backup`;
        await fs.writeFile(backupPath, original, "utf-8");
      }

      // 應用 diff（簡單實現：解析 unified diff）
      const patched = applyUnifiedDiff(original, diffContent);

      // 寫回文件
      await fs.writeFile(filePath, patched, "utf-8");

      return {
        success: true,
        output: `成功應用補丁到文件: ${filePath}`,
        metadata: {
          path: filePath,
          originalSize: original.length,
          patchedSize: patched.length,
          backup: createBackup ? `${filePath}.backup` : null,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `應用補丁失敗: ${errorMsg}`,
      };
    }
  },
};

/**
 * 簡單的 unified diff 應用實現
 * 注意：這是一個簡化版本，只支持基本的 +/- 行操作
 */
function applyUnifiedDiff(original: string, diff: string): string {
  const originalLines = original.split("\n");
  const diffLines = diff.split("\n");
  const result: string[] = [];

  let originalIndex = 0;
  let inHunk = false;
  let hunkOriginalStart = 0;

  for (const line of diffLines) {
    // 解析 hunk 標頭：@@ -1,5 +1,6 @@
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        hunkOriginalStart = parseInt(match[1], 10) - 1; // 轉為 0-based
        // 將未處理的原始行加入結果
        while (originalIndex < hunkOriginalStart) {
          result.push(originalLines[originalIndex]);
          originalIndex++;
        }
        inHunk = true;
      }
      continue;
    }

    if (!inHunk) continue;

    // 跳過 diff 元數據行
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("\\")) {
      continue;
    }

    if (line.startsWith("+")) {
      // 新增行
      result.push(line.slice(1));
    } else if (line.startsWith("-")) {
      // 刪除行：跳過原始行
      originalIndex++;
    } else if (line.startsWith(" ")) {
      // 上下文行：保持不變
      result.push(line.slice(1));
      originalIndex++;
    } else {
      // 普通行（無前綴）：視為上下文
      result.push(line);
      originalIndex++;
    }
  }

  // 加入剩餘的原始行
  while (originalIndex < originalLines.length) {
    result.push(originalLines[originalIndex]);
    originalIndex++;
  }

  return result.join("\n");
}

