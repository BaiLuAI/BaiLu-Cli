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
 * /undo - 回滚文件修改
 * 支持单个文件回滚和批量回滚
 * 用法:
 *   /undo <數字> - 回滚指定的单个文件
 *   /undo all - 回滚所有备份文件
 *   /undo <數字1> <數字2> ... - 回滚多个指定的文件
 *   /undo - 显示可回滚的文件列表
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

    // 处理批量回滚逻辑
    if (args.length > 0) {
      // 检查是否是批量回滚所有文件
      if (args[0].toLowerCase() === 'all') {
        // 确认用户意图
        return {
          handled: true,
          response: chalk.yellow(`警告: 即將回滚 ${backupFiles.length} 個文件。請使用 /undo confirm all 確認操作。`),
        };
      }

      // 检查是否是确认批量操作
      if (args[0].toLowerCase() === 'confirm' && args[1]?.toLowerCase() === 'all') {
        let successCount = 0;
        let failedCount = 0;
        const failedFiles: string[] = [];

        // 回滚所有文件
        for (const backupPath of backupFiles) {
          try {
            const originalPath = backupPath.replace(/\.backup$/, '');
            fs.copyFileSync(backupPath, originalPath);
            successCount++;
          } catch (error) {
            failedCount++;
            failedFiles.push(path.relative(process.cwd(), backupPath.replace(/\.backup$/, '')));
          }
        }

        let response = chalk.green(`✓ 批量回滚完成: 成功 ${successCount} 個文件`);

        if (failedCount > 0) {
          response += chalk.red(`，失败 ${failedCount} 個文件`);
          response += chalk.gray(`\n失败文件: ${failedFiles.join(', ')}`);
        }

        return {
          handled: true,
          response,
        };
      }

      // 处理多个文件索引
      const indices: number[] = [];
      let hasInvalidIndex = false;

      for (const arg of args) {
        const index = parseInt(arg, 10) - 1;
        if (isNaN(index) || index < 0 || index >= backupFiles.length) {
          hasInvalidIndex = true;
          break;
        }
        indices.push(index);
      }

      if (hasInvalidIndex) {
        return {
          handled: true,
          response: chalk.red(`無效的索引。請使用 1-${backupFiles.length} 之間的數字，或使用 "all" 回滚所有文件`),
        };
      }

      // 确认用户意图
      const fileNames = indices.map(i => {
        const originalPath = backupFiles[i].replace(/\.backup$/, '');
        return path.relative(process.cwd(), originalPath);
      });

      return {
        handled: true,
        response: chalk.yellow(`警告: 即將回滚 ${indices.length} 個文件: ${fileNames.join(', ')}。請使用 /undo confirm ${args.join(' ')} 確認操作。`),
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

    response += chalk.yellow(`\n用法:\n`);
    response += chalk.gray(`  ${chalk.bold("/undo <數字>")} - 回滚指定的文件 (例如: /undo 1)\n`);
    response += chalk.gray(`  ${chalk.bold("/undo <數字1> <數字2> ...")} - 回滚多个文件 (例如: /undo 1 3 5)\n`);
    response += chalk.gray(`  ${chalk.bold("/undo all")} - 回滚所有文件\n`);
    response += chalk.gray(`  ${chalk.bold("/undo confirm <args>")} - 确认并执行操作\n`);

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
