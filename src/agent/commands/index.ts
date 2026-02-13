/**
 * 命令處理器統一入口
 * 將所有命令處理器整合並導出
 */

import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";

// 導入各個命令處理器模組
import { handleHelp, handleClear, handleClearChat, handleHistory, handleCompress } from "./basic.js";
import { handleModel, handleListModels } from "./model.js";
import { handleStatus, handleTokens, handleStats } from "./status.js";
import { handleSettings, handleMode } from "./config.js";
import { handleAddFiles, handleDropFiles, handleListFiles } from "./file.js";
import { handleUndo, handleCommit } from "./git.js";
import { handleSaveSession, handleLoadSession, handleListSessions } from "./session.js";
import { handleWorkspace, handleReview } from "./workspace.js";
import { handleCustomCommand, listCustomCommands } from "./custom.js";

/**
 * 統一的命令處理器入口
 * 根據命令類型分發到對應的處理器
 */
export async function handleSlashCommand(
  input: string,
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    // 基本命令
    case "/help":
    case "/h":
      return handleHelp();

    case "/clear":
    case "/c":
      return handleClear(context);

    case "/clear-chat":
      return handleClearChat();

    case "/history":
      return handleHistory(context);

    case "/compress":
      return handleCompress(context);

    case "/exit":
    case "/quit":
    case "/q":
      return { handled: true, shouldExit: true };

    // 模型管理
    case "/model":
    case "/m":
      return await handleModel(args, context);

    case "/models":
      return await handleListModels(context);

    // 狀態與信息
    case "/status":
    case "/s":
      return handleStatus(context);

    case "/tokens":
    case "/t":
      return handleTokens(context);

    case "/stats":
      return handleStats(context);

    // 配置管理
    case "/settings":
      return await handleSettings(args);

    case "/mode":
      return await handleMode(args);

    // 文件管理
    case "/add":
      return await handleAddFiles(args, context);

    case "/drop":
      return await handleDropFiles(args, context);

    case "/files":
      return handleListFiles(context);

    // Git 相關
    case "/undo":
    case "/u":
      return await handleUndo(args);

    case "/commit":
      return await handleCommit(context);

    // 會話管理
    case "/save":
      return await handleSaveSession(args, context);

    case "/load":
      return await handleLoadSession(args, context);

    case "/sessions":
      return await handleListSessions(context);

    // 工作區與審查
    case "/workspace":
      return handleWorkspace(context);

    case "/review":
      return await handleReview(args, context);

    default:
      // 嘗試自定義命令（.bailu/commands/*.md）
      return await handleCustomCommand(command, args, context);
  }
}

// 重新導出類型定義，方便其他模組使用
export type { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
