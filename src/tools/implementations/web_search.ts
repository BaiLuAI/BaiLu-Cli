/**
 * 網絡搜索工具 - 搜索網絡獲取最新資訊
 * 類似 Google 搜索，但內建於工具系統，更安全且輸出格式化
 */

import { Tool, ToolResult } from "../types.js";

const MAX_RESULTS = 10;

export const webSearchTool: Tool = {
  definition: {
    name: "web_search",
    description: "搜索網絡獲取最新資訊。適合查詢技術文檔、Stack Overflow、GitHub Issues 等。返回搜索結果的標題、摘要和鏈接。",
    safe: true,
    parameters: [
      {
        name: "query",
        type: "string",
        description: "搜索關鍵詞或問題",
        required: true,
      },
      {
        name: "num_results",
        type: "number",
        description: "返回結果數量（默認 5，最多 10）",
        required: false,
        default: 5,
      },
    ],
  },

  handler: async (params): Promise<ToolResult> => {
    try {
      const query = params.query as string;
      const numResults = Math.min((params.num_results as number) || 5, MAX_RESULTS);

      if (!query) {
        return { success: false, error: "搜索關鍵詞不能為空" };
      }

      // 使用 DuckDuckGo Instant Answer API（免費，無需 API Key）
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'BailuCLI/1.0',
        },
        signal: AbortSignal.timeout(10000), // 10 秒超時
      });

      if (!response.ok) {
        throw new Error(`搜索請求失敗: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      let output = `🔍 搜索結果：${query}\n\n`;

      // 處理 Instant Answer
      if (data.AbstractText) {
        output += `📖 即時答案：\n${data.AbstractText}\n\n`;
        if (data.AbstractURL) {
          output += `🔗 來源：${data.AbstractURL}\n\n`;
        }
      }

      // 處理 Related Topics
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        output += `📚 相關主題：\n`;
        const topics = data.RelatedTopics.slice(0, numResults);
        for (let i = 0; i < topics.length; i++) {
          const topic = topics[i];
          if (topic.Text) {
            output += `${i + 1}. ${topic.Text}\n`;
            if (topic.FirstURL) {
              output += `   🔗 ${topic.FirstURL}\n`;
            }
            output += `\n`;
          }
        }
      }

      // 處理 Results（如果有的話）
      if (data.Results && data.Results.length > 0) {
        output += `🌐 搜索結果：\n`;
        const results = data.Results.slice(0, numResults);
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          output += `${i + 1}. ${result.Text || '無標題'}\n`;
          if (result.FirstURL) {
            output += `   🔗 ${result.FirstURL}\n`;
          }
          output += `\n`;
        }
      }

      // 如果沒有任何結果
      if (!data.AbstractText && (!data.RelatedTopics || data.RelatedTopics.length === 0) && (!data.Results || data.Results.length === 0)) {
        output += `未找到關於 "${query}" 的搜索結果。\n\n`;
        output += `💡 建議：\n`;
        output += `- 嘗試更具體的關鍵詞\n`;
        output += `- 使用英文搜索可能獲得更多結果\n`;
        output += `- 檢查拼寫是否正確\n`;
      }

      return {
        success: true,
        output,
        metadata: {
          query,
          hasAbstract: !!data.AbstractText,
          relatedTopicsCount: data.RelatedTopics?.length || 0,
          resultsCount: data.Results?.length || 0,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `網絡搜索失敗: ${errorMsg}` };
    }
  },
};
