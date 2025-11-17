/**
 * 讀取文件工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types";

export const readFileTool: Tool = {
  definition: {
    name: "read_file",
    description: "讀取指定路徑的文件內容",
    parameters: [
      {
        name: "path",
        type: "string",
        description: "文件的相對或絕對路徑",
        required: true,
      },
      {
        name: "encoding",
        type: "string",
        description: "文件編碼，默認 utf-8",
        required: false,
        default: "utf-8",
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const filePath = params.path as string;
      const encoding = (params.encoding as BufferEncoding) || "utf-8";

      // 安全檢查：確保路徑不包含惡意字符
      if (filePath.includes("..") && !path.isAbsolute(filePath)) {
        return {
          success: false,
          error: "不允許使用相對路徑 '..'，請使用絕對路徑或工作區內的相對路徑",
        };
      }

      const content = await fs.readFile(filePath, encoding);

      return {
        success: true,
        output: content,
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
        error: `讀取文件失敗: ${errorMsg}`,
      };
    }
  },
};

