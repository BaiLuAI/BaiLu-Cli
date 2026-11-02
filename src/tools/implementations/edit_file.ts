/**
 * 精確編輯工具（比照 Claude Code 的 Edit）
 *
 * 用 old_string → new_string 精確替換檔案內容，而非整檔覆寫：
 * - 省 token：不需要輸出整個檔案
 * - 更安全：old_string 匹配不到或匹配多次時報錯，不會誤覆蓋
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types.js";
import { validatePath } from "../../utils/path-validator.js";
import { wasFileRead } from "../read-tracker.js";

export const editFileTool: Tool = {
  definition: {
    name: "edit_file",
    description:
      "對檔案做精確的字符串替換編輯。old_string 必須與檔案內容完全一致（含縮排與換行）。" +
      "修改檔案時優先用此工具，僅在建立新檔或全面重寫時才用 write_file。" +
      "注意：修改前必須先用 read_file 讀取該檔案。",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "要編輯的檔案路徑",
        required: true,
      },
      {
        name: "old_string",
        type: "string",
        description: "要被替換的原始文本（必須與檔案內容完全一致）",
        required: true,
      },
      {
        name: "new_string",
        type: "string",
        description: "替換後的新文本（設為空字符串即刪除該段文本）",
        required: true,
      },
      {
        name: "replace_all",
        type: "boolean",
        description: "是否替換所有匹配（默認 false，僅替換唯一匹配）",
        required: false,
        default: false,
      },
    ],
  },

  handler: async (params, context): Promise<ToolResult> => {
    try {
      const inputPath = params.path;
      const oldString = params.old_string;
      const newString = params.new_string;
      const replaceAll = params.replace_all === true;

      // 參數驗證
      if (typeof inputPath !== "string" || !inputPath.trim()) {
        return { success: false, error: "路徑參數無效：必須是非空字符串" };
      }
      if (typeof oldString !== "string" || oldString.length === 0) {
        return { success: false, error: "old_string 參數無效：必須是非空字符串（要刪除內容請用空 new_string）" };
      }
      if (typeof newString !== "string") {
        return { success: false, error: "new_string 參數無效：必須是字符串" };
      }
      if (oldString === newString) {
        return { success: false, error: "old_string 與 new_string 相同，沒有需要修改的內容" };
      }

      const workspaceRoot = context?.workspaceRoot || process.cwd();
      const pathValidation = validatePath(inputPath, workspaceRoot);
      if (!pathValidation.valid) {
        return { success: false, error: `🔒 路徑驗證失敗: ${pathValidation.error}` };
      }
      const absolutePath = pathValidation.normalizedPath!;

      // 讀取檔案（先確認存在性，再檢查先讀後寫）
      let content: string;
      try {
        content = await fs.readFile(absolutePath, "utf-8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return {
            success: false,
            error: `檔案不存在: ${absolutePath}\n提示：建立新檔案請用 write_file`,
          };
        }
        throw error;
      }

      // 先讀後寫強制：必須先 read_file 才能編輯（防止基於過期內容編輯）
      if (!wasFileRead(absolutePath)) {
        return {
          success: false,
          error:
            `編輯前必須先讀取檔案。請先調用 read_file(path="${inputPath}")，` +
            `確認最新內容後再執行 edit_file（防止基於過期內容編輯造成代碼丟失）。`,
        };
      }

      // 匹配檢查
      const occurrenceCount = content.split(oldString).length - 1;
      if (occurrenceCount === 0) {
        return {
          success: false,
          error:
            `old_string 在檔案中找不到匹配。\n` +
            `提示：old_string 必須與檔案內容完全一致（含縮排、換行、標點）。` +
            `請先用 read_file 確認最新內容，必要時包含更多上下文行。`,
        };
      }
      if (occurrenceCount > 1 && !replaceAll) {
        return {
          success: false,
          error:
            `old_string 在檔案中匹配到 ${occurrenceCount} 處，需要唯一匹配才能替換。\n` +
            `提示：在 old_string 中包含更多前後文使其唯一，或設 replace_all=true 替換全部 ${occurrenceCount} 處。`,
        };
      }

      // 執行替換
      const updated =
        replaceAll && occurrenceCount > 1
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);

      await fs.writeFile(absolutePath, updated, "utf-8");

      // 統計
      const oldLines = oldString.split("\n").length;
      const newLines = newString.split("\n").length;
      const replacedCount = replaceAll ? occurrenceCount : 1;

      return {
        success: true,
        output:
          `成功編輯檔案: ${absolutePath}\n` +
          `替換 ${replacedCount} 處（-${oldLines} 行 +${newLines} 行）`,
        metadata: {
          path: absolutePath,
          relativePath: path.relative(workspaceRoot, absolutePath),
          replacements: replacedCount,
          oldLines,
          newLines,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `編輯檔案失敗: ${errorMsg}` };
    }
  },
};
