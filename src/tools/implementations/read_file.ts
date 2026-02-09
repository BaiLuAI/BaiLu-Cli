/**
 * 讀取文件工具
 */

import fs from "fs/promises";
import path from "path";
import { Tool, ToolResult } from "../types.js";
import { validatePath } from "../../utils/path-validator.js";

export const readFileTool: Tool = {
  definition: {
    name: "read_file",
    description: "讀取指定路徑的文件內容",
    safe: true, // 只读操作，自动批准
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

      // 使用统一的路径验证工具
      const workspaceRoot = process.cwd();
      const pathValidation = validatePath(filePath, workspaceRoot);
      
      if (!pathValidation.valid) {
        return {
          success: false,
          error: `🔒 路径验证失败: ${pathValidation.error}`,
        };
      }
      
      const absolutePath = pathValidation.normalizedPath!;
      const content = await fs.readFile(absolutePath, encoding);

      return {
        success: true,
        output: content,
        metadata: {
          path: absolutePath,
          relativePath: path.relative(workspaceRoot, absolutePath),
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
