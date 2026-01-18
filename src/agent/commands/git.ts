/**
 * Git 相關命令處理器
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { autoCommitWithAI } from "../../git/auto-commit.js";
import { hasUncommittedChanges, getChangedFiles } from "../../git/integration.js";
import { findGitRoot, isInGitRepo } from "../../utils/git.js";

/**
 * /undo - 回滚最近的文件修改
 */
export async function handleUndo(args: string[]): Promise<SlashCommandResult> {
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
export async function handleCommit(context: SlashCommandContext): Promise<SlashCommandResult> {
  const workspaceRoot = context.workspaceContext.rootPath;

  try {
    // 检查是否在 Git 仓库中
    if (!isInGitRepo(workspaceRoot)) {
      return {
        handled: true,
        response: chalk.red("✗ 当前目录不是 Git 仓库"),
      };
    }

    // 获取 Git 根目录
    const gitRoot = findGitRoot(workspaceRoot);
    if (!gitRoot) {
      return {
        handled: true,
        response: chalk.red("✗ 无法找到 Git 根目录"),
      };
    }

    // 检查是否有变更
    if (!hasUncommittedChanges(gitRoot)) {
      return {
        handled: true,
        response: chalk.yellow("沒有需要提交的變更"),
      };
    }

    // 显示变更的文件
    const changedFiles = getChangedFiles(gitRoot);
    console.log(chalk.cyan("\n變更的文件:"));
    changedFiles.forEach((file) => {
      console.log(chalk.gray(`  - ${file}`));
    });
    console.log();

    // 使用 AI 生成提交信息并提交
    const result = await autoCommitWithAI(gitRoot, context.llmClient, {
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
