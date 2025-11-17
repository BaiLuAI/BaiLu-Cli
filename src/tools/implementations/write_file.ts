/**
 * 寫入文件工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types";

export const writeFileTool: Tool = {
  definition: {
    name: "write_file",
    description: "寫入內容到指定路徑的文件（會覆蓋原有內容）",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "文件的相對或絕對路徑",
        required: true,
      },
      {
        name: "content",
        type: "string",
        description: "要寫入的內容",
        required: true,
      },
      {
        name: "create_dirs",
        type: "boolean",
        description: "如果目錄不存在，是否自動創建，默認 true",
        required: false,
        default: true,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const filePath = params.path as string;
      const content = params.content as string;
      const createDirs = params.create_dirs !== false;

      // 安全檢查
      if (filePath.includes("..") && !path.isAbsolute(filePath)) {
        return {
          success: false,
          error: "不允許使用相對路徑 '..'，請使用絕對路徑或工作區內的相對路徑",
        };
      }

      // 如果需要，創建父目錄
      if (createDirs) {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
      }

      // 寫入文件
      await fs.writeFile(filePath, content, "utf-8");

      return {
        success: true,
        output: `成功寫入文件: ${filePath}`,
        metadata: {
          path: filePath,
          size: content.length,
          lines: content.split("\n").length,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `寫入文件失敗: ${errorMsg}`,
      };
    }
  },
};

