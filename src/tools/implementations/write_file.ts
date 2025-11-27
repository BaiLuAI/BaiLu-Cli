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
      // Validate path parameter
      if (typeof params.path !== 'string' || !params.path.trim()) {
        return {
          success: false,
          error: '路徑參數無效：必須是非空字符串',
        };
      }
      const inputPath = params.path.trim();

      // Validate content parameter
      if (typeof params.content !== 'string') {
        return {
          success: false,
          error: '內容參數無效：必須是字符串',
        };
      }
      const content = params.content;

      // Validate create_dirs parameter
      const createDirs = params.create_dirs !== false;

      // Security: Validate and sanitize file path to prevent path traversal attacks
      const workspaceRoot = process.cwd();
      let absolutePath: string;

      // Resolve to absolute path
      if (path.isAbsolute(inputPath)) {
        absolutePath = path.normalize(inputPath);
      } else {
        absolutePath = path.resolve(workspaceRoot, inputPath);
      }

      // Critical security check: ensure the resolved path is within workspace
      if (!absolutePath.startsWith(workspaceRoot)) {
        return {
          success: false,
          error: `🔒 安全檢查失敗：路徑遍歷攻擊檢測\n路徑 "${inputPath}" 解析到工作區外: ${absolutePath}\n僅允許在工作區內操作: ${workspaceRoot}`,
        };
      }

      // Additional check: reject paths with suspicious patterns
      const suspicious = ['../', '..\\', '%2e%2e'];
      if (suspicious.some(pattern => inputPath.includes(pattern))) {
        return {
          success: false,
          error: `🔒 安全檢查失敗：路徑包含可疑字符 "${inputPath}"`,
        };
      }

      // Check if file exists before writing (for metadata)
      let fileExisted = false;
      try {
        await fs.access(absolutePath);
        fileExisted = true;
      } catch {
        fileExisted = false;
      }

      // Check if parent directory exists when createDirs is false
      const dir = path.dirname(absolutePath);
      
      if (createDirs) {
        try {
          await fs.mkdir(dir, { recursive: true });
        } catch (mkdirError) {
          const mkdirMsg = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
          return {
            success: false,
            error: `創建目錄失敗: ${mkdirMsg}\n目錄: ${dir}`,
          };
        }
      } else {
        // Check if directory exists
        try {
          await fs.access(dir);
        } catch {
          return {
            success: false,
            error: `目錄不存在且 create_dirs=false: ${dir}\n請先創建目錄或設置 create_dirs=true`,
          };
        }
      }

      // Write file
      await fs.writeFile(absolutePath, content, "utf-8");

      // Calculate lines accurately (count newlines + 1 for last line)
      const lineCount = content === '' ? 0 : (content.match(/\n/g) || []).length + 1;

      return {
        success: true,
        output: `成功寫入文件: ${absolutePath}`,
        metadata: {
          path: absolutePath,
          relativePath: path.relative(workspaceRoot, absolutePath),
          size: content.length,
          lines: lineCount,
          created: !fileExisted,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCode = (error as any)?.code;
      
      // Provide more specific error messages
      let detailedError = `寫入文件失敗: ${errorMsg}`;
      
      if (errorCode === 'EACCES') {
        detailedError += '\n原因: 權限不足，無法寫入文件';
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

