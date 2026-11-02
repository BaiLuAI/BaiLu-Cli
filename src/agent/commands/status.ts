/**
 * 狀態與信息命令處理器
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { formatDuration } from "./utils.js";

/**
 * /status - 顯示 CLI 狀態
 */
export function handleStatus(context: SlashCommandContext): SlashCommandResult {
  const currentModel = context.llmClient.getModelName();
  const baseUrl = context.llmClient.getBaseUrl();
  const uptime = Date.now() - context.sessionStats.startTime.getTime();
  const uptimeStr = formatDuration(uptime);

  const status = `
${chalk.bold.cyan("CLI 狀態：")}

${chalk.yellow("模型信息：")}
  當前模型: ${chalk.green(currentModel)}
  API 端點: ${baseUrl}

${chalk.yellow("會話統計：")}
  對話輪數: ${context.sessionStats.messagesCount}
  工具調用: ${context.sessionStats.toolCallsCount}
  運行時間: ${uptimeStr}

${chalk.yellow("工作區：")}
  根目錄: ${context.workspaceContext.rootPath}
  配置文件: ${context.workspaceContext.config ? "✓ 已載入" : "✗ 未找到"}
`;

  return { handled: true, response: status };
}

/**
 * /tokens - 顯示 token 使用情況
 */
export function handleTokens(context: SlashCommandContext): SlashCommandResult {
  let totalTokens = 0;

  // 粗略估算：中文 ~1.5 tokens/字，英文 ~0.25 tokens/word
  for (const msg of context.messages) {
    const content = msg.content || "";
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    totalTokens += Math.ceil(chineseChars * 1.5 + englishWords * 0.25);
  }

  const tokens = `
${chalk.bold.cyan("Token 使用情況：")}

${chalk.yellow("當前會話：")}
  對話消息數: ${context.messages.length}
  估算 tokens: ~${totalTokens}
  
${chalk.gray("注意：這只是粗略估算，實際 token 數由白鹿 API 計算")}
${chalk.gray("使用 /compress 可以壓縮對話歷史，減少 token 使用")}
`;

  return { handled: true, response: tokens };
}

/**
 * /stats - 显示会话性能统计
 */
export function handleStats(context: SlashCommandContext): SlashCommandResult {
  const stats = context.sessionStats;
  
  if (!stats) {
    return {
      handled: true,
      response: chalk.yellow("无法获取会话统计信息"),
    };
  }

  // 计算会话时长
  const sessionDuration = Date.now() - stats.startTime.getTime();
  const durationStr = formatDuration(sessionDuration);
  
  // 计算平均响应时间
  const avgResponseTime = stats.apiCallsCount > 0 
    ? (stats.totalResponseTime / stats.apiCallsCount / 1000).toFixed(2) 
    : "0";
  
  // 估算成本（假设每 1000 tokens = $0.002）
  const estimatedCost = (stats.totalTokensUsed / 1000 * 0.002).toFixed(4);

  let response = chalk.cyan("\n📊 会话统计信息\n\n");
  
  response += chalk.bold("⏱️  时间统计：\n");
  response += chalk.gray(`  • 会话时长: ${durationStr}\n`);
  response += chalk.gray(`  • API 调用次数: ${stats.apiCallsCount}\n`);
  response += chalk.gray(`  • 平均响应时间: ${avgResponseTime}s\n`);
  if (stats.lastRequestTime > 0) {
    response += chalk.gray(`  • 上次请求耗时: ${(stats.lastRequestTime / 1000).toFixed(2)}s\n`);
  }
  
  response += chalk.bold("\n💬 对话统计：\n");
  response += chalk.gray(`  • 消息数量: ${stats.messagesCount}\n`);
  response += chalk.gray(`  • 工具调用次数: ${stats.toolCallsCount}\n`);
  
  response += chalk.bold("\n🎯 Token 使用：\n");
  response += chalk.gray(`  • 总 Token 使用: ${stats.totalTokensUsed.toLocaleString()}\n`);
  response += chalk.gray(`  • 估算成本: $${estimatedCost}\n`);
  response += chalk.gray(`  • 平均每次请求: ${stats.apiCallsCount > 0 ? Math.round(stats.totalTokensUsed / stats.apiCallsCount).toLocaleString() : 0} tokens\n`);
  
  response += chalk.bold("\n📝 内容统计：\n");
  response += chalk.gray(`  • 活跃文件: ${context.fileManager?.getActiveFiles().length || 0}\n`);
  
  response += chalk.gray("\n💡 提示: Token 使用量为估算值（基于字符数）\n");

  return {
    handled: true,
    response,
  };
}
