/**
 * 斜線命令系統（Slash Commands）
 * 在 chat 模式下使用，例如 /help, /model, /status 等
 */

import chalk from "chalk";
import { LLMClient, ChatMessage } from "../llm/client";
import { WorkspaceContext } from "./types";
import { getConfig, saveConfig } from "../config";
import { autoCommitWithAI } from "../git/auto-commit";
import { hasUncommittedChanges, getChangedFiles } from "../git/integration";

export interface SlashCommandContext {
  llmClient: LLMClient;
  workspaceContext: WorkspaceContext;
  messages: ChatMessage[];
  sessionStats: {
    messagesCount: number;
    toolCallsCount: number;
    startTime: Date;
  };
}

export interface SlashCommandResult {
  handled: boolean;
  shouldExit?: boolean;
  shouldClearHistory?: boolean;
  response?: string;
}

/**
 * 檢查並處理斜線命令
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
    case "/help":
    case "/h":
      return handleHelp();

    case "/model":
    case "/m":
      return await handleModel(args, context);

    case "/models":
      return await handleListModels(context);

    case "/status":
    case "/s":
      return handleStatus(context);

    case "/tokens":
    case "/t":
      return handleTokens(context);

    case "/clear":
    case "/c":
      return handleClear();

    case "/history":
      return handleHistory(context);

    case "/compress":
      return handleCompress(context);

    case "/settings":
      return await handleSettings(args);

    case "/mode":
      return await handleMode(args);

    case "/undo":
    case "/u":
      return await handleUndo(args);

    case "/commit":
      return await handleCommit(context);

    case "/exit":
    case "/quit":
    case "/q":
      return { handled: true, shouldExit: true };

    default:
      // 未知命令，返回错误（chat.ts 会提示用户输入 / 查看命令）
      return { handled: false };
  }
}

/**
 * /help - 顯示幫助信息
 */
function handleHelp(): SlashCommandResult {
  const help = `
${chalk.bold.cyan("可用的斜線命令：")}

${chalk.yellow("基本命令：")}
  ${chalk.green("/help, /h")}          - 顯示此幫助信息
  ${chalk.green("/exit, /quit, /q")}  - 退出 CLI
  ${chalk.green("/clear, /c")}        - 清空對話歷史

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
  ${chalk.green("/settings set <key> <value>")} - 修改配置
  ${chalk.green("/mode [模式]")}      - 切換安全模式（dry-run/review/auto-apply）

${chalk.yellow("進階功能：")}
  ${chalk.green("/compress")}         - 壓縮對話上下文（保留摘要）
  ${chalk.green("/workspace")}        - 查看工作區信息
  ${chalk.green("/undo, /u")}        - 回滾最近的文件修改
  ${chalk.green("/commit")}           - 使用 AI 生成提交信息並自動提交

${chalk.gray("提示：斜線命令不會發送給 AI，只在本地處理")}
`;

  return { handled: true, response: help };
}

/**
 * /model - 切換模型
 */
async function handleModel(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
  if (args.length === 0) {
    // 顯示當前模型
    const currentModel = context.llmClient["model"];
    return {
      handled: true,
      response: chalk.cyan(`當前使用模型: ${chalk.bold(currentModel)}\n使用 /models 查看所有可用模型`),
    };
  }

  const newModel = args[0];
  context.llmClient["model"] = newModel;

  return {
    handled: true,
    response: chalk.green(`✓ 已切換到模型: ${chalk.bold(newModel)}`),
  };
}

/**
 * /models - 列出所有可用模型
 */
async function handleListModels(context: SlashCommandContext): Promise<SlashCommandResult> {
  try {
    console.log(chalk.gray("正在獲取模型列表..."));
    const models = await context.llmClient.listModels();
    const currentModel = context.llmClient["model"];

    let response = chalk.cyan("\n可用模型：\n");
    for (const model of models) {
      const mark = model === currentModel ? chalk.green("● ") : "  ";
      response += `${mark}${model}\n`;
    }

    response += chalk.gray(`\n使用 /model <模型ID> 切換模型`);

    return { handled: true, response };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`獲取模型列表失敗: ${error}`),
    };
  }
}

/**
 * /status - 顯示 CLI 狀態
 */
function handleStatus(context: SlashCommandContext): SlashCommandResult {
  const currentModel = context.llmClient["model"];
  const baseUrl = context.llmClient["baseUrl"];
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
function handleTokens(context: SlashCommandContext): SlashCommandResult {
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
 * /clear - 清空對話歷史
 */
function handleClear(): SlashCommandResult {
  return {
    handled: true,
    shouldClearHistory: true,
    response: chalk.green("✓ 對話歷史已清空"),
  };
}

/**
 * /history - 顯示對話歷史摘要
 */
function handleHistory(context: SlashCommandContext): SlashCommandResult {
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
function handleCompress(context: SlashCommandContext): SlashCommandResult {
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

/**
 * /settings - 配置管理
 */
async function handleSettings(args: string[]): Promise<SlashCommandResult> {
  if (args.length === 0) {
    // 顯示當前配置
    const config = await getConfig();
    let settings = `\n${chalk.bold.cyan("當前配置：")}\n\n`;

    settings += chalk.yellow("API 配置：\n");
    settings += `  API Key: ${config.apiKey ? chalk.green("✓ 已設置") : chalk.red("✗ 未設置")}\n`;
    settings += `  模型: ${config.model || chalk.gray("(使用默認)")}\n`;
    settings += `  端點: ${config.baseUrl || chalk.gray("(使用默認)")}\n\n`;

    settings += chalk.yellow("安全模式：\n");
    settings += `  當前模式: ${process.env.BAILU_MODE || "review"}\n\n`;

    settings += chalk.gray("使用 /settings set <key> <value> 修改配置\n");
    settings += chalk.gray("例如: /settings set model bailu-2.5-pro");

    return { handled: true, response: settings };
  }

  if (args[0] === "set" && args.length >= 3) {
    const key = args[1];
    const value = args.slice(2).join(" ");

    const config = await getConfig();
    (config as any)[key] = value;
    await saveConfig(config);

    return {
      handled: true,
      response: chalk.green(`✓ 已設置 ${key} = ${value}`),
    };
  }

  return {
    handled: true,
    response: chalk.red("用法: /settings 或 /settings set <key> <value>"),
  };
}

/**
 * /mode - 切換安全模式
 */
async function handleMode(args: string[]): Promise<SlashCommandResult> {
  const validModes = ["dry-run", "review", "auto-apply"];

  if (args.length === 0) {
    const currentMode = process.env.BAILU_MODE || "review";
    let response = chalk.cyan(`當前安全模式: ${chalk.bold(currentMode)}\n\n`);
    response += chalk.yellow("可用模式：\n");
    response += `  ${chalk.green("dry-run")}    - 僅顯示計畫，不執行\n`;
    response += `  ${chalk.green("review")}     - 每個操作前確認（默認）\n`;
    response += `  ${chalk.green("auto-apply")} - 自動執行（危險）\n\n`;
    response += chalk.gray("使用 /mode <模式> 切換");
    return { handled: true, response };
  }

  const newMode = args[0].toLowerCase();
  if (!validModes.includes(newMode)) {
    return {
      handled: true,
      response: chalk.red(`無效的模式: ${newMode}\n可用: ${validModes.join(", ")}`),
    };
  }

  process.env.BAILU_MODE = newMode;

  return {
    handled: true,
    response: chalk.green(`✓ 已切換到 ${chalk.bold(newMode)} 模式`),
  };
}

/**
 * /undo - 回滚最近的文件修改
 */
async function handleUndo(args: string[]): Promise<SlashCommandResult> {
  const fs = require("fs");
  const path = require("path");
  
  try {
    // 查找所有 .backup 文件
    const findBackupFiles = (dir: string, fileList: string[] = []): string[] => {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
          findBackupFiles(filePath, fileList);
        } else if (file.endsWith('.backup')) {
          fileList.push(filePath);
        }
      }
      
      return fileList;
    };
    
    const backupFiles = findBackupFiles(process.cwd());
    
    if (backupFiles.length === 0) {
      return {
        handled: true,
        response: chalk.yellow("沒有找到可以回滾的備份文件"),
      };
    }
    
    // 按修改时间排序，最新的在前
    backupFiles.sort((a, b) => {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statB.mtimeMs - statA.mtimeMs;
    });
    
    // 如果指定了文件索引
    if (args.length > 0) {
      const index = parseInt(args[0], 10) - 1;
      if (index < 0 || index >= backupFiles.length) {
        return {
          handled: true,
          response: chalk.red(`無效的索引。請使用 1-${backupFiles.length} 之間的數字`),
        };
      }
      
      const backupPath = backupFiles[index];
      const originalPath = backupPath.replace(/\.backup$/, '');
      
      // 恢复文件
      fs.copyFileSync(backupPath, originalPath);
      
      return {
        handled: true,
        response: chalk.green(`✓ 已恢復文件: ${path.relative(process.cwd(), originalPath)}`),
      };
    }
    
    // 显示可用的备份列表
    let response = chalk.cyan("\n可回滾的文件（按時間排序）：\n\n");
    
    backupFiles.slice(0, 10).forEach((backupPath, index) => {
      const originalPath = backupPath.replace(/\.backup$/, '');
      const relativePath = path.relative(process.cwd(), originalPath);
      const stat = fs.statSync(backupPath);
      const time = new Date(stat.mtime).toLocaleString('zh-CN');
      
      response += `  ${chalk.green(index + 1)}. ${chalk.bold(relativePath)}\n`;
      response += `     ${chalk.gray(`備份時間: ${time}`)}\n\n`;
    });
    
    if (backupFiles.length > 10) {
      response += chalk.gray(`... 還有 ${backupFiles.length - 10} 個備份\n\n`);
    }
    
    response += chalk.yellow(`\n使用方法: ${chalk.bold("/undo <數字>")} 來恢復指定的文件\n`);
    response += chalk.gray(`例如: /undo 1\n`);
    
    return {
      handled: true,
      response,
    };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`錯誤: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * /commit - 使用 AI 生成提交信息并自动提交
 */
async function handleCommit(context: SlashCommandContext): Promise<SlashCommandResult> {
  const rootPath = context.workspaceContext.rootPath;

  try {
    // 检查是否有变更
    if (!hasUncommittedChanges(rootPath)) {
      return {
        handled: true,
        response: chalk.yellow("沒有需要提交的變更"),
      };
    }

    // 显示变更的文件
    const changedFiles = getChangedFiles(rootPath);
    console.log(chalk.cyan("\n變更的文件:"));
    changedFiles.forEach((file) => {
      console.log(chalk.gray(`  - ${file}`));
    });
    console.log();

    // 使用 AI 生成提交信息并提交
    const result = await autoCommitWithAI(rootPath, context.llmClient, {
      style: "conventional",
      maxLength: 100,
    });

    if (result.success) {
      return {
        handled: true,
        response: chalk.green(`✓ 提交成功\n提交信息: ${result.message}`),
      };
    } else {
      return {
        handled: true,
        response: chalk.red(`✗ 提交失敗: ${result.error}`),
      };
    }
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`錯誤: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * 格式化持續時間
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

