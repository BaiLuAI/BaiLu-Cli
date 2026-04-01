/**
 * 網頁抓取工具 - 抓取網頁內容
 * 類似 curl/wget，但內建於工具系統，更安全且輸出格式化
 */

import { Tool, ToolResult } from "../types.js";

const MAX_CONTENT_LENGTH = 50000; // 最大內容長度（字符）
const MAX_LINE_LENGTH = 200;

export const webFetchTool: Tool = {
  definition: {
    name: "web_fetch",
    description: "抓取網頁內容並返回文本。適合讀取在線文檔、GitHub README、API 文檔等。自動提取主要文本內容，去除 HTML 標籤。",
    safe: true,
    parameters: [
      {
        name: "url",
        type: "string",
        description: "要抓取的網頁 URL",
        required: true,
      },
      {
        name: "extract_text",
        type: "boolean",
        description: "是否提取純文本（去除 HTML 標籤），默認 true",
        required: false,
        default: true,
      },
      {
        name: "max_length",
        type: "number",
        description: "最大內容長度（字符），默認 50000",
        required: false,
        default: MAX_CONTENT_LENGTH,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const url = params.url as string;
      const extractText = params.extract_text !== false;
      const maxLength = (params.max_length as number) || MAX_CONTENT_LENGTH;

      if (!url) {
        return { success: false, error: "URL 不能為空" };
      }

      // 驗證 URL 格式
      try {
        new URL(url);
      } catch {
        return { success: false, error: `無效的 URL: ${url}` };
      }

      // 只允許 HTTP/HTTPS
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: "只支持 HTTP 和 HTTPS 協議" };
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'BailuCLI/1.0 (Web Fetch Tool)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(15000), // 15 秒超時
        redirect: 'follow', // 跟隨重定向
      });

      if (!response.ok) {
        throw new Error(`HTTP 請求失敗: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      
      // 檢查是否是文本類型
      if (!contentType.includes('text/') && 
          !contentType.includes('application/json') && 
          !contentType.includes('application/xml') &&
          !contentType.includes('application/javascript')) {
        return { 
          success: false, 
          error: `不支持的內容類型: ${contentType}。此工具主要用於抓取文本內容。` 
        };
      }

      let content = await response.text();

      // 提取文本（去除 HTML 標籤）
      if (extractText && contentType.includes('text/html')) {
        content = extractTextFromHtml(content);
      }

      // 截斷過長的內容
      let truncated = false;
      if (content.length > maxLength) {
        content = content.substring(0, maxLength);
        truncated = true;
      }

      // 格式化輸出
      let output = `🌐 網頁內容：${url}\n`;
      output += `📄 內容類型：${contentType}\n`;
      output += `📏 內容長度：${content.length} 字符`;
      if (truncated) {
        output += `（已截斷）`;
      }
      output += `\n\n`;
      output += `${'─'.repeat(60)}\n\n`;
      output += content;
      output += `\n\n${'─'.repeat(60)}\n`;

      if (truncated) {
        output += `\n⚠️ 內容已截斷（顯示前 ${maxLength} 字符）。如需查看更多內容，請使用 max_length 參數。\n`;
      }

      return {
        success: true,
        output,
        metadata: {
          url,
          contentType,
          contentLength: content.length,
          truncated,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `網頁抓取失敗: ${errorMsg}` };
    }
  },
};

/**
 * 從 HTML 中提取純文本
 * 簡單實現，去除 HTML 標籤和多餘空白
 */
function extractTextFromHtml(html: string): string {
  let text = html;

  // 移除 script 和 style 標籤及其內容
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 移除 HTML 標籤
  text = text.replace(/<[^>]+>/g, ' ');

  // 解碼 HTML 實體
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // 移除多餘空白
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');

  // 移除首尾空白
  text = text.trim();

  return text;
}
