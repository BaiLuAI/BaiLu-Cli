/**
 * 應用 diff 補丁工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types.js";
import { validatePath } from "../../utils/path-validator.js";

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

  handler: async (params, context): Promise<ToolResult> => {
    try {
      // Validate path parameter
      if (typeof params.path !== 'string' || !params.path.trim()) {
        return {
          success: false,
          error: '路徑參數無效：必須是非空字符串',
        };
      }
      const inputPath = params.path.trim();

      // Validate diff parameter
      if (typeof params.diff !== 'string' || !params.diff.trim()) {
        return {
          success: false,
          error: 'Diff 參數無效：必須是非空字符串',
        };
      }
      const diffContent = params.diff.trim();

      // Validate diff format (basic check)
      if (!diffContent.includes('@@') && !diffContent.startsWith('---')) {
        return {
          success: false,
          error: 'Diff 格式無效：不是有效的 unified diff 格式\n提示：應包含 @@ hunk 標記或 --- 文件標記',
        };
      }

      const createBackup = params.create_backup !== false;

      // 使用統一的路徑驗證工具（含 symlink 解析和敏感目錄檢查）
      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const pathValidation = validatePath(inputPath, workspaceRoot);
      
      if (!pathValidation.valid) {
        return {
          success: false,
          error: `🔒 路徑驗證失敗: ${pathValidation.error}`,
        };
      }

      const filePath = pathValidation.normalizedPath!;

      // Read original file
      let original: string;
      let fileExists = false;
      try {
        original = await fs.readFile(filePath, "utf-8");
        fileExists = true;
      } catch (readError: unknown) {
        // Check if it's a "file not found" error
        const hasCode = (err: unknown): err is { code: string; message: string } => {
          return typeof err === 'object' && err !== null && 'code' in err;
        };
        if (hasCode(readError) && readError.code === 'ENOENT') {
          // File doesn't exist - check if diff creates new file
          if (diffContent.includes('--- /dev/null') || diffContent.includes('--- a/dev/null')) {
            // This is a new file creation diff
            original = "";
            fileExists = false;
          } else {
            return {
              success: false,
              error: `文件不存在: ${filePath}\n提示：如果要創建新文件，diff 應包含 "--- /dev/null"`,
            };
          }
        } else {
          // Other read errors
          const errorMsg = hasCode(readError) ? readError.message : String(readError);
          return {
            success: false,
            error: `讀取文件失敗: ${errorMsg}\n文件: ${filePath}`,
          };
        }
      }

      // Create backup if file exists and backup is enabled
      let backupPath: string | null = null;
      if (createBackup && fileExists && original) {
        backupPath = `${filePath}.backup`;
        try {
          await fs.writeFile(backupPath, original, "utf-8");
        } catch (backupError: unknown) {
          const errorMsg = backupError instanceof Error ? backupError.message : String(backupError);
          return {
            success: false,
            error: `創建備份失敗: ${errorMsg}\n備份路徑: ${backupPath}`,
          };
        }
      }

      // Apply diff
      let patched: string;
      try {
        patched = applyUnifiedDiff(original, diffContent);
      } catch (diffError: unknown) {
        const errorMsg = diffError instanceof Error ? diffError.message : String(diffError);
        return {
          success: false,
          error: `應用 diff 失敗: ${errorMsg}\n提示：請檢查 diff 格式是否正確`,
        };
      }

      // Ensure parent directory exists
      const dir = path.dirname(filePath);
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (mkdirError: unknown) {
        const errorMsg = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
        return {
          success: false,
          error: `創建目錄失敗: ${errorMsg}\n目錄: ${dir}`,
        };
      }

      // Write file
      try {
        await fs.writeFile(filePath, patched, "utf-8");
      } catch (writeError: unknown) {
        // Try to restore from backup if write fails
        const errorMsg = writeError instanceof Error ? writeError.message : String(writeError);
        if (backupPath) {
          try {
            await fs.copyFile(backupPath, filePath);
            return {
              success: false,
              error: `寫入文件失敗，已從備份恢復: ${errorMsg}`,
            };
          } catch {
            // Backup restore also failed
          }
        }
        return {
          success: false,
          error: `寫入文件失敗: ${errorMsg}\n文件: ${filePath}`,
        };
      }

      // Calculate diff statistics
      const originalLines = original.split('\n').length;
      const patchedLines = patched.split('\n').length;
      const linesAdded = Math.max(0, patchedLines - originalLines);
      const linesRemoved = Math.max(0, originalLines - patchedLines);

      return {
        success: true,
        output: `成功應用補丁到文件: ${filePath}`,
        metadata: {
          path: filePath,
          relativePath: path.relative(workspaceRoot, filePath),
          fileCreated: !fileExists,
          originalSize: original.length,
          patchedSize: patched.length,
          originalLines,
          patchedLines,
          linesAdded,
          linesRemoved,
          backup: backupPath,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCode = (error as any)?.code;
      
      // Provide more specific error messages
      let detailedError = `應用補丁失敗: ${errorMsg}`;
      
      if (errorCode === 'EACCES') {
        detailedError += '\n原因: 權限不足';
      } else if (errorCode === 'ENOSPC') {
        detailedError += '\n原因: 磁盤空間不足';
      } else if (errorCode === 'EROFS') {
        detailedError += '\n原因: 文件系統為只讀';
      }
      
      return {
        success: false,
        error: detailedError,
      };
    }
  },
};

/**
 * Apply unified diff to original content
 * Note: This is a simplified implementation that supports basic +/- line operations
 * For complex diffs with conflicts or context mismatches, consider using a library like diff-match-patch
 */
function applyUnifiedDiff(original: string, diff: string): string {
  // Validate that diff has hunk markers
  if (!diff.includes('@@')) {
    throw new Error('Invalid diff format: missing hunk markers (@@)');
  }
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
