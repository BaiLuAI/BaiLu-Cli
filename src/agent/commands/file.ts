/**
 * 文件管理命令處理器
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";

/**
 * /add - 添加文件到上下文
 */
export async function handleAddFiles(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
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
export async function handleDropFiles(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
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
export function handleListFiles(context: SlashCommandContext): SlashCommandResult {
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
 * /view - 用分頁器查看文件完整內容（不刷屏）
 */
export async function handleViewFile(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
  if (args.length === 0) {
    return {
      handled: true,
      response: chalk.yellow("請指定要查看的文件\n") +
        chalk.gray("用法: /view <文件路径> [起始行] [結束行]\n") +
        chalk.gray("例如: /view src/index.ts\n") +
        chalk.gray("      /view src/index.ts 50 100"),
    };
  }

  const workspaceRoot = context.workspaceContext.rootPath;
  const filePath = path.isAbsolute(args[0]) ? args[0] : path.join(workspaceRoot, args[0]);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return {
      handled: true,
      response: chalk.red(`文件不存在: ${args[0]}`),
    };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n");
  const totalLines = allLines.length;

  // 處理行範圍參數
  const startLine = args[1] ? Math.max(1, parseInt(args[1], 10)) : 1;
  const endLine = args[2] ? Math.min(totalLines, parseInt(args[2], 10)) : totalLines;
  const selectedLines = allLines.slice(startLine - 1, endLine);

  // 添加行號
  const numberedContent = selectedLines
    .map((line, i) => `${String(startLine + i).padStart(4)} | ${line}`)
    .join("\n");

  const header = `📄 ${args[0]} (第 ${startLine}-${startLine + selectedLines.length - 1} 行，共 ${totalLines} 行)\n${"─".repeat(60)}\n`;

  // 嘗試使用系統分頁器
  try {
    const pagerContent = header + numberedContent;
    const isWindows = process.platform === "win32";

    if (isWindows) {
      // Windows: 用 more 分頁器
      spawnSync("more", [], {
        input: pagerContent,
        stdio: ["pipe", "inherit", "inherit"],
        shell: true,
      });
    } else {
      // Unix: 用 less -R（支持顏色）
      spawnSync("less", ["-R"], {
        input: pagerContent,
        stdio: ["pipe", "inherit", "inherit"],
      });
    }

    return {
      handled: true,
      // 分頁器已直接輸出，不需要 response
    };
  } catch {
    // 分頁器不可用，回退到直接輸出（帶行號）
    return {
      handled: true,
      response: header + numberedContent,
    };
  }
}
