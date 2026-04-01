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
        name: "start_line",
        type: "number",
        description: "起始行號（從 1 開始），不指定則從頭開始",
        required: false,
      },
      {
        name: "end_line",
        type: "number",
        description: "結束行號（包含），不指定則讀到末尾。建議每次最多讀取 200 行",
        required: false,
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
      const fullContent = await fs.readFile(absolutePath, encoding);
      const allLines = fullContent.split("\n");
      const totalLines = allLines.length;

      // 處理行範圍參數
      const startLine = params.start_line ? Math.max(1, Number(params.start_line)) : 1;
      const endLine = params.end_line ? Math.min(totalLines, Number(params.end_line)) : totalLines;

      // 大文件自動截斷：超過 200 行且未指定範圍時，只返回前 200 行
      const MAX_AUTO_LINES = 200;
      const isPartial = params.start_line || params.end_line;
      let selectedLines: string[];
      let wasAutoTruncated = false;

      if (!isPartial && totalLines > MAX_AUTO_LINES) {
        selectedLines = allLines.slice(0, MAX_AUTO_LINES);
        wasAutoTruncated = true;
      } else {
        selectedLines = allLines.slice(startLine - 1, endLine);
      }

      // 添加行號
      const actualStart = wasAutoTruncated ? 1 : startLine;
      const numberedContent = selectedLines
        .map((line, i) => `${String(actualStart + i).padStart(4)} | ${line}`)
        .join("\n");

      // 構建輸出
      let output = numberedContent;
      if (wasAutoTruncated) {
        output += `\n\n[注意] 文件共 ${totalLines} 行，已自動截斷只顯示前 ${MAX_AUTO_LINES} 行。`;
        output += `\n使用 start_line/end_line 參數查看其餘部分，例如: read_file(path, start_line=${MAX_AUTO_LINES + 1}, end_line=${Math.min(totalLines, MAX_AUTO_LINES + 200)})`;
      } else if (isPartial) {
        output += `\n\n[顯示第 ${actualStart}-${actualStart + selectedLines.length - 1} 行，共 ${totalLines} 行]`;
      }

      return {
        success: true,
        output,
        metadata: {
          path: absolutePath,
          relativePath: path.relative(workspaceRoot, absolutePath),
          size: fullContent.length,
          totalLines,
          displayedLines: selectedLines.length,
          startLine: actualStart,
          endLine: actualStart + selectedLines.length - 1,
          truncated: wasAutoTruncated,
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
