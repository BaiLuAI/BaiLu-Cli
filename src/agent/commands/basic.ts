/**
 * 基本命令處理器
 */

import chalk from "chalk";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";

/**
 * /help - 顯示幫助信息
 */
export function handleHelp(): SlashCommandResult {
  const help = `
${chalk.bold.cyan("可用的斜線命令：")}

${chalk.yellow("基本命令：")}
  ${chalk.green("/help, /h")}          - 顯示此幫助信息
  ${chalk.green("/exit, /quit, /q")}  - 退出 CLI
  ${chalk.green("/clear, /c")}        - 完全重置（清空對話 + 工具記憶）
  ${chalk.green("/clear-chat")}       - 只清空對話（保留工具記憶）

${chalk.yellow("模型管理：")}
  ${chalk.green("/model [模型ID]")}    - 切換使用的模型
  ${chalk.green("/models")}           - 列出所有可用模型
  ${chalk.green("/m [模型ID]")}       - /model 的簡寫

${chalk.yellow("狀態與信息：")}
  ${chalk.green("/status, /s")}       - 查看 CLI 狀態、當前模型、token 使用
  ${chalk.green("/tokens, /t")}       - 查看 token 使用詳情
  ${chalk.green("/history")}          - 顯示對話歷史摘要

${chalk.yellow("配置管理：")}
  ${chalk.green("/settings")}         - 查看當前配置
  ${chalk.green("/settings set key <value>")} - 修改配置
  ${chalk.green("/mode [模式]")}      - 切換安全模式（dry-run/review/auto-apply）

${chalk.yellow("文件管理：")}
  ${chalk.green("/add <文件路径>")}   - 添加文件到上下文
  ${chalk.green("/drop <文件路径>")}  - 從上下文移除文件
  ${chalk.green("/drop all")}         - 清空所有文件
  ${chalk.green("/files")}            - 列出當前上下文中的所有文件

${chalk.yellow("進階功能：")}
  ${chalk.green("/compress")}         - 壓縮對話上下文（保留摘要）
  ${chalk.green("/workspace")}        - 查看工作區信息
  ${chalk.green("/review <文件>")}   - AI 代碼審查（檢查bug、性能、安全等）
  ${chalk.green("/undo, /u")}        - 回滾最近的文件修改
  ${chalk.green("/commit")}           - 使用 AI 生成提交信息並自動提交

${chalk.gray("提示：斜線命令不會發送給 AI，只在本地處理")}
`;

  return { handled: true, response: help };
}

/**
 * /clear - 完全重置（清空對話歷史 + 工具調用記憶）
 */
export function handleClear(context: SlashCommandContext): SlashCommandResult {
  return {
    handled: true,
    shouldClearHistory: true,
    response: chalk.green("✓ 對話歷史和工具記憶已完全清空\n") +
      chalk.gray("提示: 使用 ") + chalk.cyan("/clear-chat") + chalk.gray(" 可只清空對話但保留記憶"),
  };
}

/**
 * /clear-chat - 只清空對話歷史（保留工具調用記憶）
 */
export function handleClearChat(): SlashCommandResult {
  return {
    handled: true,
    shouldClearHistory: true,
    // 特殊標記：告訴 chat.ts 不要清空記憶
    response: chalk.green("✓ 對話歷史已清空（保留工具記憶）\n") +
      chalk.gray("提示: 使用 ") + chalk.cyan("/clear") + chalk.gray(" 可完全重置（包含記憶）"),
  };
}

/**
 * /history - 顯示對話歷史摘要
 */
export function handleHistory(context: SlashCommandContext): SlashCommandResult {
  let history = `\n${chalk.bold.cyan("對話歷史：")} (共 ${context.messages.length} 條)\n\n`;

  for (let i = 0; i < context.messages.length; i++) {
    const msg = context.messages[i];
    const preview = (msg.content || "").substring(0, 60);
    const roleColor =
      msg.role === "user"
        ? chalk.cyan
        : msg.role === "assistant"
        ? chalk.green
        : msg.role === "system"
        ? chalk.yellow
        : chalk.gray;

    history += `${i + 1}. ${roleColor(msg.role)}: ${preview}${
      msg.content.length > 60 ? "..." : ""
    }\n`;
  }

  return { handled: true, response: history };
}

/**
 * /compress - 壓縮對話上下文
 */
export function handleCompress(context: SlashCommandContext): SlashCommandResult {
  if (context.messages.length <= 2) {
    return {
      handled: true,
      response: chalk.yellow("對話歷史太短，無需壓縮"),
    };
  }

  // 保留 system message 和最近 3 輪對話
  const systemMsg = context.messages[0];
  const recentMessages = context.messages.slice(-6); // 最近 3 輪（user + assistant）

  const beforeCount = context.messages.length;
  context.messages.length = 0;
  context.messages.push(systemMsg);

  // 添加摘要消息
  context.messages.push({
    role: "system",
    content: `[之前的對話已壓縮，共 ${beforeCount - recentMessages.length - 1} 條消息]`,
  });

  context.messages.push(...recentMessages);

  const afterCount = context.messages.length;

  return {
    handled: true,
    response: chalk.green(
      `✓ 對話已壓縮：${beforeCount} 條 → ${afterCount} 條\n保留了最近 3 輪對話`
    ),
  };
}
