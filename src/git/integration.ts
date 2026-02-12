import { spawnSync } from "child_process";
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Git');

export interface GitStatusEntry {
  path: string;
  statusCode: string;
}

export interface GitSummary {
  branch?: string;
  insideWorkTree: boolean;
  status: GitStatusEntry[];
}

/**
 * Execute git command safely using spawnSync to prevent command injection
 * @param rootPath Working directory
 * @param args Git command arguments (not including 'git')
 * @returns Command output or null if failed
 */
function runGit(rootPath: string, args: string[]): string | null {
  try {
    // Use spawnSync with array arguments to prevent shell injection
    const result = spawnSync('git', args, {
      cwd: rootPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    
    // Check if command succeeded
    if (result.status !== 0) {
      if (result.stderr) {
        logger.debug(`Git Error - ${args.join(' ')}: ${result.stderr}`);
      }
      return null;
    }
    
    return result.stdout.trim();
  } catch (error) {
    logger.debug(`Git Exception - ${args.join(' ')}:`, error);
    return null;
  }
}

export function getGitSummary(rootPath: string): GitSummary {
  const inside = runGit(rootPath, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inside) {
    return { insideWorkTree: false, status: [] };
  }

  const branch = runGit(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined;
  const rawStatus = runGit(rootPath, ["status", "--porcelain"]) ?? "";

  const status: GitStatusEntry[] = rawStatus
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim(); // More descriptive variable name
      return { statusCode: code, path: filePath };
    });

  return {
    insideWorkTree: true,
    branch,
    status,
  };
}

/**
 * 检查是否有未提交的变更
 */
export function hasUncommittedChanges(rootPath: string): boolean {
  const summary = getGitSummary(rootPath);
  return summary.insideWorkTree && summary.status.length > 0;
}

/**
 * 获取变更的文件列表
 */
export function getChangedFiles(rootPath: string): string[] {
  const summary = getGitSummary(rootPath);
  return summary.status.map((s) => s.path);
}

/**
 * 获取文件的 diff
 */
export function getFileDiff(rootPath: string, filePath?: string): string {
  const args = filePath ? ["diff", "HEAD", filePath] : ["diff", "HEAD"];
  return runGit(rootPath, args) || "";
}

/**
 * Execute git add safely
 * @param rootPath Working directory
 * @param files Files to add, or undefined for all files (-A)
 * @returns true if successful
 */
export function gitAdd(rootPath: string, files?: string[]): boolean {
  try {
    // Build args array safely - no string concatenation
    const args = files && files.length > 0 ? ["add", ...files] : ["add", "-A"];
    
    const result = spawnSync('git', args, {
      cwd: rootPath,
      stdio: 'ignore',
    });
    
    return result.status === 0;
  } catch (error) {
    logger.error('Git Add Error:', error);
    return false;
  }
}

/**
 * Execute git commit safely
 * @param rootPath Working directory
 * @param message Commit message (will be properly escaped)
 * @returns true if successful
 */
export function gitCommit(rootPath: string, message: string): boolean {
  try {
    // Use array form - git will handle the message safely
    // No need for manual escaping, spawnSync prevents shell injection
    const result = spawnSync('git', ['commit', '-m', message], {
      cwd: rootPath,
      stdio: 'ignore',
    });
    
    return result.status === 0;
  } catch (error) {
    logger.error('Git Commit Error:', error);
    return false;
  }
}

/**
 * 回滾單個文件到 HEAD 版本（git checkout HEAD -- <file>）
 * @param rootPath Git 根目錄
 * @param filePath 要回滾的文件（相對路徑）
 * @returns true if successful
 */
export function gitRestoreFile(rootPath: string, filePath: string): boolean {
  const result = runGit(rootPath, ['checkout', 'HEAD', '--', filePath]);
  return result !== null;
}

/**
 * 回滾所有未提交的變更（git checkout HEAD -- .）
 * @param rootPath Git 根目錄
 * @returns true if successful
 */
export function gitRestoreAll(rootPath: string): boolean {
  const result = runGit(rootPath, ['checkout', 'HEAD', '--', '.']);
  return result !== null;
}

/**
 * 創建 Git stash 快照（在 Agent 開始修改前保存狀態）
 * @param rootPath Git 根目錄
 * @param message stash 描述
 * @returns true if successful
 */
export function gitStashSave(rootPath: string, message: string): boolean {
  const result = runGit(rootPath, ['stash', 'push', '-m', message]);
  return result !== null && !result.includes('No local changes');
}

/**
 * 恢復最近的 stash
 * @param rootPath Git 根目錄
 * @returns true if successful
 */
export function gitStashPop(rootPath: string): boolean {
  const result = runGit(rootPath, ['stash', 'pop']);
  return result !== null;
}

/**
 * 獲取已修改但未提交的文件列表（含狀態碼）
 * @param rootPath Git 根目錄
 * @returns 修改的文件條目
 */
export function getModifiedFiles(rootPath: string): GitStatusEntry[] {
  const summary = getGitSummary(rootPath);
  return summary.status.filter(s => s.statusCode === 'M' || s.statusCode === 'MM' || s.statusCode === 'A' || s.statusCode === 'AM' || s.statusCode === '??');
}

/**
 * 自动提交变更
 */
export function autoCommit(rootPath: string, message: string, files?: string[]): boolean {
  if (!hasUncommittedChanges(rootPath)) {
    return false;
  }

  const addSuccess = gitAdd(rootPath, files);
  if (!addSuccess) {
    return false;
  }

  return gitCommit(rootPath, message);
}
