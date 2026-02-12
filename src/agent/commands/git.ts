/**
 * Git 相關命令處理器
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { SlashCommandContext, SlashCommandResult } from "../slash-commands.js";
import { autoCommitWithAI } from "../../git/auto-commit.js";
import { hasUncommittedChanges, getChangedFiles, getModifiedFiles, gitRestoreFile, gitRestoreAll, getFileDiff } from "../../git/integration.js";
import { findGitRoot, isInGitRepo } from "../../utils/git.js";

/**
 * /undo - 回滚文件修改（優先使用 Git）
 * 在 Git 倉庫中：使用 git checkout HEAD -- <file> 回滾
 * 非 Git 環境：回退到查找 .backup 文件
 * 用法:
 *   /undo - 顯示可回滾的文件列表
 *   /undo <數字> - 回滚指定的文件
 *   /undo all - 回滚所有變更
 */
export async function handleUndo(args: string[]): Promise<SlashCommandResult> {
  try {
    const cwd = process.cwd();
    const gitRoot = findGitRoot(cwd);

    // 優先使用 Git 回滾
    if (gitRoot && isInGitRepo(cwd)) {
      return handleGitUndo(args, gitRoot);
    }

    // 非 Git 環境：回退到 .backup 文件方式
    return handleBackupUndo(args, cwd);
  } catch (error) {
    return {
      handled: true,
      response: chalk.red(`錯誤: ${error instanceof Error ? error.message : String(error)}`),
    };
  }
}

/**
 * Git 模式回滾
 */
function handleGitUndo(args: string[], gitRoot: string): SlashCommandResult {
  const modifiedFiles = getModifiedFiles(gitRoot);

  if (modifiedFiles.length === 0) {
    return {
      handled: true,
      response: chalk.yellow("沒有未提交的變更可以回滾"),
    };
  }

  // /undo all — 回滾全部
  if (args.length > 0 && args[0].toLowerCase() === 'all') {
    const success = gitRestoreAll(gitRoot);
    if (success) {
      return {
        handled: true,
        response: chalk.green(`✓ 已回滾所有 ${modifiedFiles.length} 個文件的變更（git checkout HEAD -- .）`),
      };
    }
    return {
      handled: true,
      response: chalk.red("✗ Git 回滾失敗，請手動執行 git checkout HEAD -- ."),
    };
  }

  // /undo <數字> [<數字> ...] — 回滾指定文件
  if (args.length > 0) {
    const indices: number[] = [];
    for (const arg of args) {
      const index = parseInt(arg, 10) - 1;
      if (isNaN(index) || index < 0 || index >= modifiedFiles.length) {
        return {
          handled: true,
          response: chalk.red(`無效的索引。請使用 1-${modifiedFiles.length} 之間的數字`),
        };
      }
      indices.push(index);
    }

    let successCount = 0;
    const results: string[] = [];
    for (const idx of indices) {
      const file = modifiedFiles[idx].path;
      const ok = gitRestoreFile(gitRoot, file);
      if (ok) {
        successCount++;
        results.push(chalk.green(`  ✓ ${file}`));
      } else {
        results.push(chalk.red(`  ✗ ${file} — 回滾失敗`));
      }
    }

    return {
      handled: true,
      response: chalk.cyan("回滾結果：\n") + results.join("\n") +
        chalk.gray(`\n\n（共 ${successCount}/${indices.length} 個文件回滾成功）`),
    };
  }

  // /undo — 顯示可回滾文件列表
  let response = chalk.cyan("\n可回滾的文件（Git 未提交變更）：\n\n");

  modifiedFiles.forEach((entry, index) => {
    const statusLabel = entry.statusCode === '??' ? '新增' :
                        entry.statusCode === 'A' || entry.statusCode === 'AM' ? '已暫存' : '已修改';
    response += `  ${chalk.green(index + 1)}. ${chalk.bold(entry.path)} ${chalk.gray(`[${statusLabel}]`)}\n`;
  });

  response += chalk.yellow(`\n用法:\n`);
  response += chalk.gray(`  ${chalk.bold("/undo <數字>")} - 回滾指定文件 (例如: /undo 1)\n`);
  response += chalk.gray(`  ${chalk.bold("/undo 1 3 5")} - 回滾多個文件\n`);
  response += chalk.gray(`  ${chalk.bold("/undo all")} - 回滾所有變更\n`);

  return { handled: true, response };
}

/**
 * .backup 文件模式回滾（非 Git 環境回退方案）
 */
function handleBackupUndo(args: string[], cwd: string): SlashCommandResult {
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

  const backupFiles = findBackupFiles(cwd);

  if (backupFiles.length === 0) {
    return {
      handled: true,
      response: chalk.yellow("沒有找到可回滾的備份（非 Git 倉庫，也無 .backup 文件）"),
    };
  }

  backupFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  // /undo all
  if (args.length > 0 && args[0].toLowerCase() === 'all') {
    let successCount = 0;
    for (const bp of backupFiles) {
      try {
        fs.copyFileSync(bp, bp.replace(/\.backup$/, ''));
        successCount++;
      } catch { /* skip */ }
    }
    return {
      handled: true,
      response: chalk.green(`✓ 批量回滾完成: ${successCount}/${backupFiles.length} 個文件`),
    };
  }

  // /undo <數字>
  if (args.length > 0) {
    const indices: number[] = [];
    for (const arg of args) {
      const idx = parseInt(arg, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= backupFiles.length) {
        return {
          handled: true,
          response: chalk.red(`無效的索引。請使用 1-${backupFiles.length} 之間的數字`),
        };
      }
      indices.push(idx);
    }

    const results: string[] = [];
    for (const idx of indices) {
      const bp = backupFiles[idx];
      const orig = bp.replace(/\.backup$/, '');
      try {
        fs.copyFileSync(bp, orig);
        results.push(chalk.green(`  ✓ ${path.relative(cwd, orig)}`));
      } catch {
        results.push(chalk.red(`  ✗ ${path.relative(cwd, orig)}`));
      }
    }
    return { handled: true, response: chalk.cyan("回滾結果：\n") + results.join("\n") };
  }

  // 列表
  let response = chalk.cyan("\n可回滾的備份文件：\n\n");
  backupFiles.slice(0, 10).forEach((bp, i) => {
    const rel = path.relative(cwd, bp.replace(/\.backup$/, ''));
    const time = new Date(fs.statSync(bp).mtime).toLocaleString('zh-CN');
    response += `  ${chalk.green(i + 1)}. ${chalk.bold(rel)} ${chalk.gray(`(${time})`)}\n`;
  });
  if (backupFiles.length > 10) {
    response += chalk.gray(`\n... 還有 ${backupFiles.length - 10} 個備份\n`);
  }
  response += chalk.yellow(`\n用法: /undo <數字> | /undo all\n`);
  return { handled: true, response };
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
