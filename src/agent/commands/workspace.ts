/**
 * 工作區和代碼審查命令處理器
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { getGitSummary } from "../../git/integration.js";
import { reviewCodeFile, formatReviewResult } from "../code-review.js";

/**
 * /workspace - 查看工作區信息
 */
export function handleWorkspace(context: SlashCommandContext): SlashCommandResult {
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
 * /review - 代码审查
 */
export async function handleReview(args: string[], context: SlashCommandContext): Promise<SlashCommandResult> {
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
