/**
 * 斜線命令系統（Slash Commands）
 * 在 chat 模式下使用，例如 /help, /model, /status 等
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import { LLMClient, ChatMessage } from "../llm/client";
import { WorkspaceContext } from "./types";
import { getConfig, saveConfig } from "../config";
import { autoCommitWithAI } from "../git/auto-commit";
import { hasUncommittedChanges, getChangedFiles, getGitSummary } from "../git/integration";
import { reviewCodeFile, formatReviewResult } from "./code-review";

export interface SlashCommandContext {
  llmClient: LLMClient;
  workspaceContext: WorkspaceContext;
  messages: ChatMessage[];
  sessionStats: {
    messagesCount: number;
    toolCallsCount: number;
    totalTokensUsed: number;
    totalResponseTime: number;
    apiCallsCount: number;
    filesModified: number;
    startTime: Date;
    lastRequestTime: number;
  };
  // 文件管理功能
  fileManager?: {
    addFile: (filepath: string) => void;
    removeFile: (filepath: string) => void;
    clearFiles: () => void;
    getActiveFiles: () => string[];
  };
  // 会话管理功能
  sessionManager?: {
    saveCurrentSession: (name?: string) => Promise<string>;
    loadSession: (sessionIdOrName: string) => Promise<boolean>;
    listSessions: () => Promise<any[]>;
    deleteSession: (sessionIdOrName: string) => Promise<boolean>;
  };
}

export interface SlashCommandResult {
  handled: boolean;
  shouldExit?: boolean;
  shouldClearHistory?: boolean;
  response?: string;
  // 添加到对话历史（用于 /review 等需要后续引用的命令）
  addToHistory?: {
    userMessage: string;    // 用户的命令
    assistantMessage: string; // AI 的响应（纯文本，用于对话历史）
  };
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

    case "/review":
      return await handleReview(args, context);

    case "/workspace":
      return handleWorkspace(context);

    case "/add":
      return await handleAddFiles(args, context);

    case "/drop":
      return await handleDropFiles(args, context);

    case "/files":
      return handleListFiles(context);

    case "/stats":
      return handleStats(context);

    case "/save":
      return await handleSaveSession(args, context);

    case "/load":
      return await handleLoadSession(args, context);

    case "/sessions":
      return await handleListSessions(context);

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
      const successMsg = `✓ 提交成功\n提交信息: ${result.message}`;
      return {
        handled: true,
        response: chalk.green(successMsg),
        // 添加到历史，让 AI 记住提交了什么
        addToHistory: {
          userMessage: '/commit',
          assistantMessage: `已成功提交代码\n提交信息: ${result.message}\n变更文件: ${changedFiles.join(', ')}`,
        },
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
 * /review - 代码审查
 */
async function handleReview(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: chalk.yellow("請指定要審查的文件\n") +
        chalk.gray("用法: /review <文件路径>\n") +
        chalk.gray("例如: /review src/agent/chat.ts\n") +
        chalk.gray("      /review src/utils/helper.ts"),
    };
  }

  const workspaceRoot = context.workspaceContext.rootPath;
  const filePattern = args.join(" ");
  
  // 处理相对路径
  const filePath = path.isAbsolute(filePattern) 
    ? filePattern 
    : path.join(workspaceRoot, filePattern);
  
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return {
      handled: true,
      response: chalk.red(`文件不存在: ${filePattern}\n`) +
        chalk.gray("提示: 使用相对于项目根目录的路径"),
    };
  }

  // 检查是否是文件（而不是目录）
  if (!fs.statSync(filePath).isFile()) {
    return {
      handled: true,
      response: chalk.red(`路径不是文件: ${filePattern}`),
    };
  }

  // 检查是否是代码文件
  const ext = path.extname(filePath).toLowerCase();
  const codeExtensions = [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs',
    '.cpp', '.c', '.cs', '.rb', '.php', '.swift', '.kt', '.vue',
    '.html', '.css', '.scss', '.json', '.yaml', '.yml', '.md'
  ];
  
  // 显示警告但继续执行（不要 return）
  if (!codeExtensions.includes(ext)) {
    console.log(chalk.yellow(`警告: ${ext} 可能不是典型的代码文件`));
    console.log(chalk.gray("仍然继续审查...\n"));
  }

  try {
    console.log(chalk.cyan(`\n🔍 正在审查: ${chalk.bold(path.basename(filePath))}`));
    console.log(chalk.gray("请稍候...\n"));

    // 执行代码审查
    const result = await reviewCodeFile(filePath, context.llmClient, {
      checkBugs: true,
      checkPerformance: true,
      checkSecurity: true,
      checkStyle: true,
      checkBestPractices: true,
      maxIssues: 15,
    });

    if (!result) {
      return {
        handled: true,
        response: chalk.red("代码审查失败"),
      };
    }

    // 格式化并返回结果
    const formattedResult = formatReviewResult(result);
    
    // 构建纯文本版本用于对话历史（去除颜色代码）
    const plainTextResult = `代码审查报告: ${path.basename(filePath)}

` +
      `整体评价: ${result.summary}
` +
      `质量评分: ${result.overallScore}/100

` +
      `发现问题:
` +
      result.issues.map((issue, idx) => 
        `${idx + 1}. [${issue.type}] ${issue.category}: ${issue.message}` +
        (issue.suggestion ? `\n   建议: ${issue.suggestion}` : '')
      ).join('\n');
    
    return {
      handled: true,
      response: formattedResult,
      // 将审查结果添加到对话历史，以便后续引用
      addToHistory: {
        userMessage: `/review ${filePath}`,
        assistantMessage: plainTextResult,
      },
    };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`代码审查出错: ${error instanceof Error ? error.message : String(error)}`),
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

/**
 * /workspace - 查看工作區信息
 */
function handleWorkspace(context: SlashCommandContext): SlashCommandResult {
  const workspaceRoot = context.workspaceContext.rootPath;
  const config = context.workspaceContext.config;
  
  // 獲取 Git 狀態
  const gitSummary = getGitSummary(workspaceRoot);
  
  // 獲取工作區文件統計
  let totalFiles = 0;
  let totalDirs = 0;
  
  try {
    const countFiles = (dir: string): void => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        // 跳過常見的忽略目錄
        if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build') {
          continue;
        }
        
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          totalDirs++;
          countFiles(fullPath);
        } else if (stat.isFile()) {
          totalFiles++;
        }
      }
    };
    
    countFiles(workspaceRoot);
  } catch (error) {
    // 忽略錯誤，繼續顯示其他信息
  }
  
  // 構建響應
  let response = `\n${chalk.bold.cyan("  工作區信息：")}\n\n`;
  
  // 基本信息
  response += chalk.yellow(" 位置信息：\n");
  response += chalk.gray(`  根目錄: ${workspaceRoot}\n`);
  response += chalk.gray(`  文件總數: ${totalFiles}\n`);
  response += chalk.gray(`  目錄總數: ${totalDirs}\n\n`);
  
  // Git 信息
  response += chalk.yellow(" Git 狀態：\n");
  if (gitSummary.insideWorkTree) {
    response += chalk.gray(`  倉庫: ${chalk.green("✓ 已初始化")}\n`);
    response += chalk.gray(`  分支: ${chalk.bold(gitSummary.branch || "未知")}\n`);
    
    if (gitSummary.status.length > 0) {
      response += chalk.gray(`  變更: ${chalk.yellow(`${gitSummary.status.length} 個文件`)}\n`);
      
      // 統計變更類型
      const added = gitSummary.status.filter(s => s.statusCode.includes('A')).length;
      const modified = gitSummary.status.filter(s => s.statusCode.includes('M')).length;
      const deleted = gitSummary.status.filter(s => s.statusCode.includes('D')).length;
      const untracked = gitSummary.status.filter(s => s.statusCode.includes('?')).length;
      
      if (added > 0) response += chalk.gray(`    • 新增: ${chalk.green(added)}\n`);
      if (modified > 0) response += chalk.gray(`    • 修改: ${chalk.yellow(modified)}\n`);
      if (deleted > 0) response += chalk.gray(`    • 刪除: ${chalk.red(deleted)}\n`);
      if (untracked > 0) response += chalk.gray(`    • 未追蹤: ${chalk.cyan(untracked)}\n`);
    } else {
      response += chalk.gray(`  變更: ${chalk.green("✓ 工作區乾淨")}\n`);
    }
  } else {
    response += chalk.gray(`  倉庫: ${chalk.red("✗ 非 Git 倉庫")}\n`);
  }
  response += "\n";
  
  // 配置信息
  response += chalk.yellow("  配置狀態：\n");
  if (config) {
    response += chalk.gray(`  配置文件: ${chalk.green("✓ 已載入")}\n`);
    
    // 檢查 .bailu.yml 是否存在
    const ymlPath = path.join(workspaceRoot, '.bailu.yml');
    const configPath = path.join(workspaceRoot, '.bailu.config.json');
    
    if (fs.existsSync(ymlPath)) {
      response += chalk.gray(`  類型: ${chalk.cyan(".bailu.yml")}\n`);
    } else if (fs.existsSync(configPath)) {
      response += chalk.gray(`  類型: ${chalk.cyan(".bailu.config.json")}\n`);
    }
  } else {
    response += chalk.gray(`  配置文件: ${chalk.yellow("✗ 未找到")}\n`);
    response += chalk.gray(`  提示: 可創建 .bailu.yml 或 .bailu.config.json\n`);
  }
  response += "\n";
  
  // 活躍文件信息
  if (context.fileManager) {
    const activeFiles = context.fileManager.getActiveFiles();
    response += chalk.yellow(" 上下文文件：\n");
    
    if (activeFiles.length > 0) {
      response += chalk.gray(`  活躍文件: ${chalk.green(activeFiles.length)}\n`);
      
      // 顯示前 5 個文件
      const displayFiles = activeFiles.slice(0, 5);
      displayFiles.forEach(file => {
        response += chalk.gray(`    • ${file}\n`);
      });
      
      if (activeFiles.length > 5) {
        response += chalk.gray(`    ... 還有 ${activeFiles.length - 5} 個文件\n`);
      }
      
      response += chalk.gray(`\n  使用 ${chalk.cyan("/files")} 查看完整列表\n`);
    } else {
      response += chalk.gray(`  活躍文件: ${chalk.gray("無")}\n`);
      response += chalk.gray(`  使用 ${chalk.cyan("/add <文件>")} 添加文件到上下文\n`);
    }
  }
  
  // 构建纯文本版本用于对话历史
  const plainText = `工作区信息：\n` +
    `根目录: ${workspaceRoot}\n` +
    `文件总数: ${totalFiles}\n` +
    `目录总数: ${totalDirs}\n` +
    `Git 仓库: ${gitSummary.insideWorkTree ? '已初始化' : '未初始化'}\n` +
    (gitSummary.insideWorkTree ? `分支: ${gitSummary.branch || '未知'}\n` : '') +
    (gitSummary.insideWorkTree && gitSummary.status.length > 0 
      ? `变更文件: ${gitSummary.status.length} 个\n` 
      : '') +
    `配置文件: ${config ? '已加载' : '未找到'}\n` +
    (context.fileManager 
      ? `活跃文件: ${context.fileManager.getActiveFiles().length} 个\n` 
      : '');
  
  return {
    handled: true,
    response,
    // 添加到历史，让 AI 记住工作区状态
    addToHistory: {
      userMessage: '/workspace',
      assistantMessage: plainText,
    },
  };
}

/**
 * /add - 添加文件到上下文
 */
async function handleAddFiles(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
  if (!context.fileManager) {
    return {
      handled: true,
      response: chalk.red("文件管理功能不可用"),
    };
  }

  if (args.length === 0) {
    return {
      handled: true,
      response: chalk.yellow("請指定要添加的文件\n") +
        chalk.gray("用法: /add <文件路径>\n") +
        chalk.gray("例如: /add src/index.ts\n") +
        chalk.gray("      /add src/**/*.ts"),
    };
  }

  const workspaceRoot = context.workspaceContext.rootPath;
  const addedFiles: string[] = [];
  const failedFiles: string[] = [];

  for (const pattern of args) {
    // 处理相对路径
    const fullPath = path.isAbsolute(pattern) ? pattern : path.join(workspaceRoot, pattern);
    
    // 检查文件是否存在
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const relativePath = path.relative(workspaceRoot, fullPath);
      context.fileManager.addFile(relativePath);
      addedFiles.push(relativePath);
    } else {
      failedFiles.push(pattern);
    }
  }

  let response = "";
  if (addedFiles.length > 0) {
    response += chalk.green(`✓ 已添加 ${addedFiles.length} 個文件到上下文:\n`);
    addedFiles.forEach(f => response += chalk.gray(`  + ${f}\n`));
  }
  if (failedFiles.length > 0) {
    response += chalk.yellow(`\n未找到以下文件:\n`);
    failedFiles.forEach(f => response += chalk.gray(`  ? ${f}\n`));
  }

  return {
    handled: true,
    response: response || chalk.gray("沒有添加任何文件"),
  };
}

/**
 * /drop - 从上下文移除文件
 */
async function handleDropFiles(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
  if (!context.fileManager) {
    return {
      handled: true,
      response: chalk.red("文件管理功能不可用"),
    };
  }

  if (args.length === 0) {
    return {
      handled: true,
      response: chalk.yellow("請指定要移除的文件\n") +
        chalk.gray("用法: /drop <文件路径>\n") +
        chalk.gray("      /drop all  (清空所有)\n") +
        chalk.gray("例如: /drop src/index.ts"),
    };
  }

  // 处理 "all" 特殊情况
  if (args[0].toLowerCase() === "all") {
    const count = context.fileManager.getActiveFiles().length;
    context.fileManager.clearFiles();
    return {
      handled: true,
      response: chalk.green(`✓ 已清空所有文件 (${count} 個)`),
    };
  }

  const workspaceRoot = context.workspaceContext.rootPath;
  const removedFiles: string[] = [];

  for (const pattern of args) {
    const relativePath = path.isAbsolute(pattern) 
      ? path.relative(workspaceRoot, pattern) 
      : pattern;
    
    if (context.fileManager.getActiveFiles().includes(relativePath)) {
      context.fileManager.removeFile(relativePath);
      removedFiles.push(relativePath);
    }
  }

  if (removedFiles.length > 0) {
    let response = chalk.green(`✓ 已移除 ${removedFiles.length} 個文件:\n`);
    removedFiles.forEach(f => response += chalk.gray(`  - ${f}\n`));
    return { handled: true, response };
  } else {
    return {
      handled: true,
      response: chalk.yellow("沒有找到匹配的文件"),
    };
  }
}

/**
 * /files - 列出当前上下文中的所有文件
 */
function handleListFiles(context: SlashCommandContext): SlashCommandResult {
  if (!context.fileManager) {
    return {
      handled: true,
      response: chalk.red("文件管理功能不可用"),
    };
  }

  const files = context.fileManager.getActiveFiles();
  
  if (files.length === 0) {
    return {
      handled: true,
      response: chalk.gray("當前上下文中沒有活躍的文件\n") +
        chalk.gray("使用 ") + chalk.green("/add <文件路径>") + chalk.gray(" 添加文件"),
    };
  }

  let response = chalk.cyan(`📁 當前上下文中的文件 (${files.length}):\n\n`);
  files.forEach((file, index) => {
    response += chalk.gray(`  ${index + 1}. ${file}\n`);
  });
  response += chalk.gray(`\n使用 `) + chalk.green("/drop <文件路径>") + chalk.gray(" 移除文件");

  return {
    handled: true,
    response,
  };
}

/**
 * /stats - 显示会话性能统计
 */
function handleStats(context: SlashCommandContext): SlashCommandResult {
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

/**
 * /save - 保存当前会话
 */
async function handleSaveSession(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  if (!context.sessionManager) {
    return {
      handled: true,
      response: chalk.red("会话管理功能不可用"),
    };
  }

  const name = args.join(" ").trim();
  
  try {
    const sessionId = await context.sessionManager.saveCurrentSession(
      name || undefined
    );
    
    const displayName = name || sessionId;
    let response = chalk.green(`✓ 会话已保存: ${chalk.bold(displayName)}\n\n`);
    response += chalk.gray("使用以下命令加载:\n");
    response += chalk.cyan(`  /load ${displayName}`);
    
    return {
      handled: true,
      response,
    };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`保存会话失败: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * /load - 加载会话
 */
async function handleLoadSession(
  args: string[],
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  if (!context.sessionManager) {
    return {
      handled: true,
      response: chalk.red("会话管理功能不可用"),
    };
  }

  const sessionIdOrName = args.join(" ").trim();
  
  if (!sessionIdOrName) {
    return {
      handled: true,
      response:
        chalk.yellow("请指定要加载的会话\n") +
        chalk.gray("用法: /load <会话名称或ID>\n") +
        chalk.gray("提示: 使用 ") +
        chalk.cyan("/sessions") +
        chalk.gray(" 查看所有会话"),
    };
  }

  try {
    const success = await context.sessionManager.loadSession(sessionIdOrName);
    
    if (success) {
      let response = chalk.green(`✓ 会话已加载: ${chalk.bold(sessionIdOrName)}\n\n`);
      response += chalk.gray(`消息数: ${context.sessionStats.messagesCount}\n`);
      response += chalk.gray(`工具调用: ${context.sessionStats.toolCallsCount}\n`);
      
      if (context.fileManager) {
        const activeFiles = context.fileManager.getActiveFiles();
        if (activeFiles.length > 0) {
          response += chalk.gray(`活跃文件: ${activeFiles.length}\n`);
        }
      }
      
      return {
        handled: true,
        response,
      };
    } else {
      return {
        handled: true,
        response:
          chalk.yellow(`未找到会话: ${sessionIdOrName}\n\n`) +
          chalk.gray("使用 ") +
          chalk.cyan("/sessions") +
          chalk.gray(" 查看所有可用会话"),
      };
    }
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`加载会话失败: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * /sessions - 列出所有会话
 */
async function handleListSessions(
  context: SlashCommandContext
): Promise<SlashCommandResult> {
  if (!context.sessionManager) {
    return {
      handled: true,
      response: chalk.red("会话管理功能不可用"),
    };
  }

  try {
    const sessions = await context.sessionManager.listSessions();
    
    if (sessions.length === 0) {
      return {
        handled: true,
        response:
          chalk.gray("没有保存的会话\n\n") +
          chalk.gray("使用 ") +
          chalk.cyan("/save <名称>") +
          chalk.gray(" 保存当前会话"),
      };
    }

    let response = chalk.cyan(`💾 已保存的会话 (${sessions.length}):\n\n`);
    
    sessions.forEach((session, index) => {
      const displayName = session.name || session.sessionId;
      const date = new Date(session.lastUpdatedAt);
      const timeAgo = formatTimeAgo(date);
      
      response += chalk.bold(`${index + 1}. ${displayName}\n`);
      response += chalk.gray(`   • 消息: ${session.stats.messagesCount}\n`);
      response += chalk.gray(`   • Token: ${session.stats.totalTokensUsed.toLocaleString()}\n`);
      response += chalk.gray(`   • 更新: ${timeAgo}\n`);
      
      if (session.activeFiles && session.activeFiles.length > 0) {
        response += chalk.gray(`   • 文件: ${session.activeFiles.length}\n`);
      }
      response += "\n";
    });
    
    response += chalk.gray("使用 ") + chalk.cyan("/load <名称>") + chalk.gray(" 加载会话");
    
    return {
      handled: true,
      response,
    };
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`获取会话列表失败: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * 格式化时间差（例如 "2小时前"）
 */
function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  
  return date.toLocaleDateString("zh-CN");
}
