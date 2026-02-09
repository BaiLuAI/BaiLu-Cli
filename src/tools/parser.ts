/**
 * 解析 LLM 回應中的工具調用（基於白鹿的 XML 格式）
 */

import { ToolCall } from "./types.js";

/**
 * 從 LLM 的回應文本中提取工具調用
 * 白鹿格式：<action><invoke tool="工具名"><param name="參數名">值</param></invoke></action>
 */
export function parseToolCalls(content: string): {
  toolCalls: ToolCall[];
  textContent: string;
} {
  const toolCalls: ToolCall[] = [];
  let textContent = content;

  // 提取 <action>...</action> 區塊
  const actionRegex = /<action>([\s\S]*?)<\/action>/g;
  const actionMatches = Array.from(content.matchAll(actionRegex));

  if (actionMatches.length === 0) {
    // 沒有工具調用
    return { toolCalls: [], textContent };
  }

  // 移除 action 區塊，保留純文本
  textContent = content.replace(actionRegex, "").trim();

  for (const match of actionMatches) {
    const actionContent = match[1];

    // 提取 <invoke tool="...">...</invoke>
    const invokeRegex = /<invoke\s+tool="([^"]+)">([\s\S]*?)<\/invoke>/g;
    const invokeMatches = Array.from(actionContent.matchAll(invokeRegex));

    for (const invokeMatch of invokeMatches) {
      const toolName = invokeMatch[1];
      const paramsContent = invokeMatch[2];

      // 提取參數 <param name="...">...</param>
      // 使用 [\s\S]*? 支持多行和特殊字符（如 <, >）
      const params: Record<string, any> = {};
      const paramRegex = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
      const paramMatches = Array.from(paramsContent.matchAll(paramRegex));

      for (const paramMatch of paramMatches) {
        const paramName = paramMatch[1];
        let paramValue: string | number | boolean | null = paramMatch[2].trim();

        // 處理 CDATA 格式：<![CDATA[...]]>
        const cdataMatch = paramValue.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
        if (cdataMatch) {
          paramValue = cdataMatch[1];
        }

        // 嘗試解析 JSON（用於 array/object）
        if (paramValue.startsWith("[") || paramValue.startsWith("{")) {
          try {
            paramValue = JSON.parse(paramValue);
          } catch {
            // 保持字符串
          }
        } else if (paramValue === "true") {
          paramValue = true;
        } else if (paramValue === "false") {
          paramValue = false;
        } else if (!isNaN(Number(paramValue)) && paramValue !== "") {
          paramValue = Number(paramValue);
        }

        params[paramName] = paramValue;
      }

      toolCalls.push({
        tool: toolName,
        params,
      });
    }
  }

  return { toolCalls, textContent };
}

/**
 * 將工具結果格式化為 LLM 可讀的格式（用於下一輪對話）
 */
export function formatToolResult(toolName: string, result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  return JSON.stringify(result, null, 2);
}
